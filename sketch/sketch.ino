#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <Adafruit_SHT31.h>
#include "RTClib.h"

#include <SPI.h>
#include <SD.h>
#include <time.h>

// ================= WIFI =================
const char* WIFI_SSID = "POCO F3";
const char* WIFI_PASS = "Huunhon63b5@@@@12305";

// ================= FIREBASE =================
const String FIREBASE_BASE_URL = "https://smart-air-system-132aa-default-rtdb.firebaseio.com";
const String FIREBASE_PATH = "/air_quality";

// ================= CHÂN KẾT NỐI =================
#define SDA_PIN 21
#define SCL_PIN 22

#define SD_CS    5
#define SD_SCK   18
#define SD_MISO 19
#define SD_MOSI 23

// Cảm biến bụi
#define DUST_LED_PIN 27
#define DUST_PIN 34

// Relay & Button
#define RELAY_PIN 26
#define BUTTON_PIN 32   // Nút nhấn cắm vào GPIO32 và GND

// ================= CẤU HÌNH BỤI =================
const float VOLTAGE_DIVIDER_RATIO = 1.5;
const float DUST_ZERO_VOLTAGE = 1.00;
const float DUST_SCALE = 200.0;

// ================= NGƯỠNG ĐIỀU KHIỂN =================
float tempThreshold = 32.0;
float pm25Threshold = 50.0;

// ================= MODULE =================
LiquidCrystal_I2C lcd(0x27, 16, 2);
Adafruit_SHT31 sht30 = Adafruit_SHT31();
RTC_DS3231 rtc;

bool shtOK = false;
bool rtcOK = false;
bool sdOK = false;
bool wifiOK = false;

// ================= THỜI GIAN THỰC NTP / RTC =================
const long GMT_OFFSET_SEC = 7 * 3600;
const int DAYLIGHT_OFFSET_SEC = 0;
bool ntpOK = false;

bool syncTimeFromNTP() {
  if (WiFi.status() != WL_CONNECTED) return false;

  Serial.println("Dang dong bo thoi gian NTP...");
  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC,
             "pool.ntp.org", "time.google.com", "time.cloudflare.com");

  struct tm timeinfo;
  for (int i = 0; i < 20; i++) {
    if (getLocalTime(&timeinfo, 1000)) {
      Serial.printf("NTP OK: %04d-%02d-%02d %02d:%02d:%02d\n",
                    timeinfo.tm_year + 1900,
                    timeinfo.tm_mon + 1,
                    timeinfo.tm_mday,
                    timeinfo.tm_hour,
                    timeinfo.tm_min,
                    timeinfo.tm_sec);

      if (rtcOK) {
        rtc.adjust(DateTime(timeinfo.tm_year + 1900,
                            timeinfo.tm_mon + 1,
                            timeinfo.tm_mday,
                            timeinfo.tm_hour,
                            timeinfo.tm_min,
                            timeinfo.tm_sec));
      }
      return true;
    }
    delay(500);
  }

  Serial.println("NTP FAIL: Khong lay duoc gio Internet, dung DS3231 neu co.");
  return false;
}

DateTime getNowDateTime() {
  if (ntpOK) {
    time_t raw = time(nullptr);
    if (raw > 1700000000) {
      struct tm timeinfo;
      localtime_r(&raw, &timeinfo);
      return DateTime(timeinfo.tm_year + 1900,
                      timeinfo.tm_mon + 1,
                      timeinfo.tm_mday,
                      timeinfo.tm_hour,
                      timeinfo.tm_min,
                      timeinfo.tm_sec);
    }
  }

  if (rtcOK) return rtc.now();

  return DateTime(F(__DATE__), F(__TIME__));
}

unsigned long getUnixSecondsUTC(DateTime localNow) {
  if (ntpOK) {
    time_t raw = time(nullptr);
    if (raw > 1700000000) return (unsigned long)raw;
  }

  unsigned long localEpoch = localNow.unixtime();
  if (localEpoch > GMT_OFFSET_SEC) return localEpoch - GMT_OFFSET_SEC;
  return localEpoch;
}

// ================= TIMER =================
unsigned long lastSend = 0;
const unsigned long sendInterval = 5000;

unsigned long lastSensorRead = 0;
const unsigned long readInterval = 1000;

unsigned long lastControlCheck = 0;
const unsigned long controlCheckInterval = 3000;

// ================= BIẾN DỮ LIỆU =================
float currentTemp = 0.0;
float currentHum = 0.0;
float currentPm25 = 0.0;
int currentAqi = 0;
String currentStatus = "Tot";

// ================= BIẾN ĐIỀU KHIỂN =================
// 0: auto, 1: on, 2: off
int systemMode = 0;
bool buttonFlag = false;

bool fanState = false;
String modeStr = "auto";

// ================= CHỐNG DỘI NÚT NHẤN BẢN ĐƠN GIẢN =================
volatile bool buttonInterruptFlag = false;
volatile unsigned long lastInterruptTime = 0;
const unsigned long debounceDelay = 80;

// ================= HÀM NGẮT NÚT NHẤN =================
void IRAM_ATTR handleButtonPress() {
  unsigned long interruptTime = millis();

  if (interruptTime - lastInterruptTime > debounceDelay) {
    buttonInterruptFlag = true;
    lastInterruptTime = interruptTime;
  }
}

// ================= CẬP NHẬT QUẠT NGAY THEO CHẾ ĐỘ =================
void updateFanByModeNow() {
  if (systemMode == 0) {
    modeStr = "auto";

    if (currentTemp > tempThreshold || currentPm25 > pm25Threshold) {
      fanState = true;
    } else {
      fanState = false;
    }
  }
  else if (systemMode == 1) {
    modeStr = "on";
    fanState = true;
  }
  else if (systemMode == 2) {
    modeStr = "off";
    fanState = false;
  }

  // Relay code cũ của bạn: HIGH là bật, LOW là tắt
  if (fanState) digitalWrite(RELAY_PIN, HIGH);
  else digitalWrite(RELAY_PIN, LOW);
}

// ================= HÀM ĐỌC BỤI =================
int readDustADCOnce() {
  digitalWrite(DUST_LED_PIN, LOW);
  delayMicroseconds(280);

  int adcValue = analogRead(DUST_PIN);

  delayMicroseconds(40);
  digitalWrite(DUST_LED_PIN, HIGH);
  delayMicroseconds(9680);

  return adcValue;
}

float readDustPM25() {
  long totalADC = 0;
  const int samples = 20;

  for (int i = 0; i < samples; i++) {
    totalADC += readDustADCOnce();
    delay(1);
  }

  float rawADC = totalADC / (float)samples;
  float voltageADC = rawADC * 3.3 / 4095.0;
  float voltageSensor = voltageADC * VOLTAGE_DIVIDER_RATIO;
  float pm25 = (voltageSensor - DUST_ZERO_VOLTAGE) * DUST_SCALE;

  if (pm25 < 0) pm25 = 0;
  if (pm25 > 500) pm25 = 500;

  return pm25;
}

// ================= TÍNH AQI =================
int calcAQI(float pm25) {
  if (pm25 <= 12.0) return round((50.0 - 0.0) / (12.0 - 0.0) * (pm25 - 0.0) + 0.0);
  else if (pm25 <= 35.4) return round((100.0 - 51.0) / (35.4 - 12.1) * (pm25 - 12.1) + 51.0);
  else if (pm25 <= 55.4) return round((150.0 - 101.0) / (55.4 - 35.5) * (pm25 - 35.5) + 101.0);
  else if (pm25 <= 150.4) return round((200.0 - 151.0) / (150.4 - 55.5) * (pm25 - 55.5) + 151.0);
  else if (pm25 <= 250.4) return round((300.0 - 201.0) / (250.4 - 150.5) * (pm25 - 150.5) + 201.0);
  else if (pm25 <= 350.4) return round((400.0 - 301.0) / (350.4 - 250.5) * (pm25 - 250.5) + 301.0);
  else if (pm25 <= 500.4) return round((500.0 - 401.0) / (500.4 - 350.5) * (pm25 - 350.5) + 401.0);
  else return 500;
}

String getAQIStatus(int aqi) {
  if (aqi <= 50) return "Tot";
  if (aqi <= 100) return "Trung binh";
  if (aqi <= 150) return "Kem";
  if (aqi <= 200) return "Xau";
  if (aqi <= 300) return "Rat xau";
  return "Nguy hai";
}

String getDateTimeString(DateTime now) {
  char buffer[25];
  sprintf(buffer, "%04d-%02d-%02d %02d:%02d:%02d",
          now.year(), now.month(), now.day(),
          now.hour(), now.minute(), now.second());
  return String(buffer);
}

// ================= HÀM ĐỌC BOOLEAN TỪ JSON ĐƠN GIẢN =================
bool extractBoolValue(String payload, String key, bool &value) {
  String patternTrue = "\"" + key + "\":true";
  String patternFalse = "\"" + key + "\":false";

  if (payload.indexOf(patternTrue) != -1) {
    value = true;
    return true;
  }

  if (payload.indexOf(patternFalse) != -1) {
    value = false;
    return true;
  }

  return false;
}

// ================= HÀM ĐỌC SỐ TỪ JSON ĐƠN GIẢN =================
bool extractFloatValue(String payload, String key, float &value) {
  String pattern = "\"" + key + "\":";
  int start = payload.indexOf(pattern);

  if (start == -1) return false;

  start += pattern.length();
  int end = start;

  while (end < payload.length()) {
    char c = payload[end];

    if ((c >= '0' && c <= '9') || c == '.' || c == '-') {
      end++;
    } else {
      break;
    }
  }

  if (end == start) return false;

  value = payload.substring(start, end).toFloat();
  return true;
}

// ================= WIFI =================
void connectWiFi() {
  Serial.print("Ket noi WiFi: ");
  Serial.println(WIFI_SSID);

  WiFi.begin(WIFI_SSID, WIFI_PASS);

  int count = 0;
  while (WiFi.status() != WL_CONNECTED && count < 30) {
    delay(500);
    Serial.print(".");
    count++;
  }

  Serial.println();
  wifiOK = (WiFi.status() == WL_CONNECTED);

  if (wifiOK) Serial.println("WiFi OK");
  else Serial.println("WiFi FAIL");
}

// ================= GHI THẺ SD =================
void writeSD(String timestamp, float temp, float hum, float pm25, int aqi, String status) {
  if (!sdOK) return;

  File file = SD.open("/data.csv", FILE_APPEND);
  if (file) {
    file.print(timestamp); file.print(",");
    file.print(temp, 2); file.print(",");
    file.print(hum, 2); file.print(",");
    file.print(pm25, 2); file.print(",");
    file.print(aqi); file.print(",");
    file.println(status);
    file.close();
  }
}

// ================= SETUP =================
void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);

  pinMode(BUTTON_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(BUTTON_PIN), handleButtonPress, FALLING);

  pinMode(DUST_LED_PIN, OUTPUT);
  digitalWrite(DUST_LED_PIN, HIGH);

  analogReadResolution(12);
  analogSetPinAttenuation(DUST_PIN, ADC_11db);

  Wire.begin(SDA_PIN, SCL_PIN);

  lcd.init();
  lcd.backlight();

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Smart Air");
  lcd.setCursor(0, 1);
  lcd.print("Starting...");
  delay(1000);

  if (sht30.begin(0x44) || sht30.begin(0x45)) {
    shtOK = true;
    Serial.println("SHT30 OK");
  } else {
    shtOK = false;
    Serial.println("SHT30 FAIL");
  }

  if (rtc.begin()) {
    rtcOK = true;
    Serial.println("RTC OK");
  } else {
    rtcOK = false;
    Serial.println("RTC FAIL");
  }

  SPI.begin(SD_SCK, SD_MISO, SD_MOSI, SD_CS);

  if (SD.begin(SD_CS, SPI, 1000000)) {
    sdOK = true;
    Serial.println("SD OK");

    if (!SD.exists("/data.csv")) {
      File file = SD.open("/data.csv", FILE_WRITE);
      if (file) {
        file.println("timestamp,temperature,humidity,pm25,aqi,status");
        file.close();
      }
    }
  } else {
    sdOK = false;
    Serial.println("SD FAIL");
  }

  connectWiFi();
  ntpOK = syncTimeFromNTP();

  if (!ntpOK && rtcOK && rtc.lostPower()) {
    rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
  }

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("System Ready");
  delay(1000);
}

// ================= LOOP =================
void loop() {
  // ----------------------------------------------------
  // 0. XỬ LÝ NÚT NHẤN TỪ INTERRUPT
  // ----------------------------------------------------
  if (buttonInterruptFlag) {
    buttonInterruptFlag = false;

    systemMode++;
    if (systemMode > 2) systemMode = 0;

    buttonFlag = true;

    updateFanByModeNow();

    Serial.print(">>> [NUT NHAN] Doi che do: ");
    if (systemMode == 0) Serial.println("auto");
    else if (systemMode == 1) Serial.println("on");
    else Serial.println("off");
  }

  // ----------------------------------------------------
  // 1. NẾU CÓ BẤM NÚT TRÊN MẠCH -> ĐỒNG BỘ LÊN WEB
  // ----------------------------------------------------
  if (buttonFlag) {
    buttonFlag = false;

    String patchPayload = "";

    if (systemMode == 0) {
      patchPayload = "{\"mode\":\"auto\",\"fan\":" + String(fanState ? "true" : "false") + "}";
    }
    else if (systemMode == 1) {
      patchPayload = "{\"mode\":\"manual\",\"fan\":true}";
    }
    else if (systemMode == 2) {
      patchPayload = "{\"mode\":\"manual\",\"fan\":false}";
    }

    Serial.print(">>> [NUT NHAN ESP32] Gui control: ");
    Serial.println(patchPayload);

    if (WiFi.status() == WL_CONNECTED) {
      WiFiClientSecure client;
      client.setInsecure();

      HTTPClient http;
      http.begin(client, FIREBASE_BASE_URL + FIREBASE_PATH + "/control.json");
      http.addHeader("Content-Type", "application/json");

      int patchCode = http.PATCH(patchPayload);

      Serial.print("Firebase control PATCH: ");
      Serial.println(patchCode);

      http.end();
    }

    lastControlCheck = millis();
  }

  // ----------------------------------------------------
  // 2. ĐỌC LỆNH TỪ WEB VỀ MẠCH, MỖI 3 GIÂY
  // ----------------------------------------------------
  if (millis() - lastControlCheck >= controlCheckInterval) {
    lastControlCheck = millis();

    if (WiFi.status() == WL_CONNECTED) {
      WiFiClientSecure client;
      client.setInsecure();

      HTTPClient http;
      http.begin(client, FIREBASE_BASE_URL + FIREBASE_PATH + "/control.json");

      int httpCode = http.GET();

      if (httpCode == 200) {
        String payload = http.getString();

        float newPm25Threshold;
        if (extractFloatValue(payload, "pm25Threshold", newPm25Threshold)) {
          if (newPm25Threshold > 0) {
            pm25Threshold = newPm25Threshold;
          }
        }

        String targetMode = "";
        bool fanFromWeb = false;
        bool hasFanValue = extractBoolValue(payload, "fan", fanFromWeb);

        if (payload.indexOf("\"mode\":\"auto\"") != -1) {
          targetMode = "auto";
        }
        else if (payload.indexOf("\"mode\":\"on\"") != -1) {
          targetMode = "on";
        }
        else if (payload.indexOf("\"mode\":\"off\"") != -1) {
          targetMode = "off";
        }
        else if (payload.indexOf("\"mode\":\"manual\"") != -1) {
          targetMode = "manual";
        }

        if (targetMode != "") {
          int webMode = systemMode;

          if (targetMode == "auto") {
            webMode = 0;
          }
          else if (targetMode == "on") {
            webMode = 1;
          }
          else if (targetMode == "off") {
            webMode = 2;
          }
          else if (targetMode == "manual" && hasFanValue) {
            if (fanFromWeb) webMode = 1;
            else webMode = 2;
          }

          if (webMode != systemMode) {
            systemMode = webMode;
            updateFanByModeNow();

            Serial.print(">>> [WEB RA LENH] Dong bo thanh: ");
            if (systemMode == 0) Serial.println("auto");
            else if (systemMode == 1) Serial.println("on");
            else Serial.println("off");
          }
        }
      }

      http.end();
    }
  }

  // ----------------------------------------------------
  // 3. ĐỌC CẢM BIẾN VÀ ĐIỀU KHIỂN QUẠT, MỖI 1 GIÂY
  // ----------------------------------------------------
  if (millis() - lastSensorRead >= readInterval) {
    lastSensorRead = millis();

    if (!shtOK || !rtcOK) {
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("I2C ERROR");
      lcd.setCursor(0, 1);

      if (!shtOK) lcd.print("SHT30 FAIL");
      else lcd.print("RTC FAIL");

      delay(1000);
      return;
    }

    if (WiFi.status() != WL_CONNECTED) {
      wifiOK = false;
      connectWiFi();
    } else {
      wifiOK = true;
    }

    currentTemp = sht30.readTemperature();
    currentHum = sht30.readHumidity();
    currentPm25 = readDustPM25();

    currentAqi = calcAQI(currentPm25);
    currentStatus = getAQIStatus(currentAqi);

    if (isnan(currentTemp)) currentTemp = 0.0;
    if (isnan(currentHum)) currentHum = 0.0;

    updateFanByModeNow();

    lcd.clear();

    lcd.setCursor(0, 0);
    lcd.print("T:");
    lcd.print(currentTemp, 1);
    lcd.print((char)223);
    lcd.print(" H:");
    lcd.print(currentHum, 0);
    lcd.print("%");

    lcd.setCursor(0, 1);
    lcd.print("P:");
    lcd.print(currentPm25, 0);

    if (systemMode == 0) lcd.print(" (A)");
    else lcd.print(" (M)");

    lcd.print(fanState ? " ON " : " OFF");
  }

  // ----------------------------------------------------
  // 4. GỬI DỮ LIỆU LÊN FIREBASE VÀ LƯU THẺ SD, MỖI 5 GIÂY
  // ----------------------------------------------------
  if (millis() - lastSend >= sendInterval) {
    lastSend = millis();

    DateTime now = getNowDateTime();
    String timestamp = getDateTimeString(now);

    unsigned long unixSeconds = getUnixSecondsUTC(now);

    String json = "{";

    json += "\"temperature\":" + String(currentTemp, 2) + ",";
    json += "\"temp\":" + String(currentTemp, 2) + ",";
    json += "\"t\":" + String(currentTemp, 2) + ",";

    json += "\"humidity\":" + String(currentHum, 2) + ",";
    json += "\"humi\":" + String(currentHum, 2) + ",";
    json += "\"h\":" + String(currentHum, 2) + ",";

    json += "\"pm25\":" + String(currentPm25, 2) + ",";
    json += "\"dust\":" + String(currentPm25, 2) + ",";
    json += "\"bui\":" + String(currentPm25, 2) + ",";

    json += "\"aqi\":" + String(currentAqi) + ",";

    json += "\"status\":\"" + currentStatus + "\",";
    json += "\"aqi_status\":\"" + currentStatus + "\",";
    json += "\"trangthai\":\"" + currentStatus + "\",";

    json += "\"fan\":" + String(fanState ? "true" : "false") + ",";
    json += "\"relay\":" + String(fanState ? "true" : "false") + ",";
    json += "\"quat\":" + String(fanState ? "true" : "false") + ",";

    json += "\"mode\":\"" + modeStr + "\",";
    json += "\"systemMode\":" + String(systemMode) + ",";

    json += "\"tempThreshold\":" + String(tempThreshold, 1) + ",";
    json += "\"pm25Threshold\":" + String(pm25Threshold, 1) + ",";

    json += "\"timeMillis\":" + String(unixSeconds) + "000,";
    json += "\"timestamp\":\"" + timestamp + "\",";
    json += "\"time\":\"" + timestamp + "\"";

    json += "}";

    if (WiFi.status() == WL_CONNECTED) {
      WiFiClientSecure client;
      client.setInsecure();

      HTTPClient http;

      http.begin(client, FIREBASE_BASE_URL + FIREBASE_PATH + "/current.json");
      http.addHeader("Content-Type", "application/json");

      int putCode = http.PUT(json);

      Serial.print("Firebase current PUT: ");
      Serial.print(putCode);
      Serial.print(" | ");
      Serial.println(timestamp);

      http.end();

      http.begin(client, FIREBASE_BASE_URL + FIREBASE_PATH + "/history.json");
      http.addHeader("Content-Type", "application/json");

      int postCode = http.POST(json);

      Serial.print("Firebase history POST: ");
      Serial.println(postCode);

      http.end();
    }

    writeSD(timestamp, currentTemp, currentHum, currentPm25, currentAqi, currentStatus);
  }
}