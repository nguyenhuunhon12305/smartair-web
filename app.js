// app.js - Logic chính cho hệ thống điều hòa không khí thông minh

let currentHistoryData = [];
let originalHistoryData = [];
let smoothingEnabled = false;
let noiseFilterEnabled = false;
let showOutliersOnly = false;
let currentSort = { column: "time", direction: "desc" };

// Trạng thái chế độ biểu đồ
let currentChartMode = "3h";
let customStartTime = null;
let customEndTime = null;

function setChartMode(mode, start = null, end = null) {
    currentChartMode = mode;
    customStartTime = start;
    customEndTime = end;
}

// ========== CHUYỂN DỮ LIỆU FIREBASE VỀ FORMAT WEB ==========
function normalizeRecord(record, key = "") {
    if (!record) {
        return null;
    }

    const temperature = Number(record.temperature ?? record.temp ?? 0);
    const humidity = Number(record.humidity ?? record.humi ?? 0);
    const pm25 = Number(record.pm25 ?? record.dust ?? 0);

    const aqi = record.aqi !== undefined
        ? Number(record.aqi)
        : calculateAQI(pm25);

    const timestamp = record.timestamp || record.time || "";

    let timeMillis = 0;

    if (record.timeMillis !== undefined && record.timeMillis !== null) {
        const t = Number(record.timeMillis);

        // Nếu ESP32 gửi Unix time dạng giây thì nhân 1000.
        // Nếu đã là milliseconds thì giữ nguyên.
        timeMillis = t < 100000000000 ? t * 1000 : t;
    } else if (timestamp) {
        timeMillis = new Date(timestamp.replace(" ", "T")).getTime();
    }

    return {
        id: key,
        temperature,
        humidity,
        pm25,
        aqi,
        status: record.status || getAQIWarning(aqi),
        fan: !!record.fan,
        mode: record.mode || "auto",
        timestamp,
        timeMillis
    };
}

// ========== HIỂN THỊ DỮ LIỆU HIỆN TẠI ==========
async function loadCurrentData(hours = 3) {
    setChartMode(hours === 6 ? "6h" : "3h");

    try {
        const current = await fetchCurrentData();

        if (current) {
            const latest = normalizeRecord(current);

            document.getElementById("currentTemp").innerText =
                latest.temperature.toFixed(1) + " °C";

            document.getElementById("currentHumidity").innerText =
                latest.humidity.toFixed(1) + " %";

            document.getElementById("currentPm25").innerText =
                latest.pm25.toFixed(1) + " µg/m³";

            const aqiElement = document.getElementById("currentAqi");
            if (aqiElement) {
                aqiElement.innerText = latest.aqi;
            }

            // Sửa lại ID: airStatus -> currentStatus
            const statusElement = document.getElementById("currentStatus");
            if (statusElement) {
                statusElement.innerText = latest.status;
            }

            // Sửa lại ID: fanState -> currentFan
            const fanElement = document.getElementById("currentFan");
            if (fanElement) {
                fanElement.innerText = latest.fan ? "Bật" : "Tắt";
            }

            // Sửa lại ID: modeState -> currentMode
            const modeElement = document.getElementById("currentMode");
            if (modeElement) {
                if (latest.mode === "auto") modeElement.innerText = "Tự động";
                else if (latest.mode === "on" || latest.mode === "manual") modeElement.innerText = "Bật thủ công";
                else if (latest.mode === "off") modeElement.innerText = "Tắt thủ công";
                else modeElement.innerText = latest.mode;
            }

            // Sửa lại ID: lastUpdate -> currentTimestamp
            const timeElement = document.getElementById("currentTimestamp");
            if (timeElement) {
                timeElement.innerText =
                    latest.timestamp || moment(latest.timeMillis).format("YYYY-MM-DD HH:mm:ss");
            }

            setConnectionOK();
        }

        const endTime = Date.now();
        const startTime = endTime - hours * 3600 * 1000;

        await loadDataForChart(startTime, endTime);

    } catch (error) {
        console.error("Lỗi loadCurrentData:", error);
    }
}

// ========== LOAD BIỂU ĐỒ ==========
async function loadDataForChart(startTime, endTime) {
    try {
        const data = await fetchHistoryDataFromFirebase();

        if (!data) {
            console.log("Không có dữ liệu history.");
            renderCharts([], [], [], [], []);
            return;
        }

        let records = Object.keys(data)
            .map(key => normalizeRecord(data[key], key))
            .filter(r => r && r.timeMillis && r.timeMillis >= startTime && r.timeMillis <= endTime)
            .sort((a, b) => a.timeMillis - b.timeMillis);

        if (records.length === 0) {
            console.log("Không có dữ liệu trong khoảng thời gian này.");
            renderCharts([], [], [], [], []);
            return;
        }

        let labels = records.map(r => moment(r.timeMillis).format("HH:mm:ss"));
        let tempData = records.map(r => r.temperature);
        let humiData = records.map(r => r.humidity);
        let pm25Data = records.map(r => r.pm25);
        let aqiData = records.map(r => r.aqi);

        if (noiseFilterEnabled) {
            tempData = filterOutliers(tempData);
            humiData = filterOutliers(humiData);
            pm25Data = filterOutliers(pm25Data);
            aqiData = filterOutliers(aqiData);
        }

        if (smoothingEnabled) {
            const windowSize = 5;
            tempData = smoothArray(tempData, windowSize);
            humiData = smoothArray(humiData, windowSize);
            pm25Data = smoothArray(pm25Data, windowSize);
            aqiData = smoothArray(aqiData, windowSize);
        }

        renderCharts(labels, tempData, humiData, pm25Data, aqiData);

    } catch (error) {
        console.error("Lỗi loadDataForChart:", error);
    }
}

// ========== CUSTOM RANGE ==========
async function loadCustomRange() {
    const startInput = document.getElementById("customStart").value;
    const endInput = document.getElementById("customEnd").value;

    if (!startInput || !endInput) {
        alert("Vui lòng chọn thời gian!");
        return;
    }

    const startTime = new Date(startInput).getTime();
    const endTime = new Date(endInput).getTime();

    if (startTime >= endTime) {
        alert("Thời gian bắt đầu phải nhỏ hơn thời gian kết thúc!");
        return;
    }

    setChartMode("custom", startTime, endTime);

    await loadDataForChart(startTime, endTime);
}

// ========== LỊCH SỬ ==========
async function loadHistoryData() {
    const startInput = document.getElementById("startDateTime").value;
    const endInput = document.getElementById("endDateTime").value;

    if (!startInput || !endInput) {
        alert("Vui lòng chọn thời gian!");
        return;
    }

    const startTime = new Date(startInput).getTime();
    const endTime = new Date(endInput).getTime();

    if (startTime >= endTime) {
        alert("Thời gian bắt đầu phải nhỏ hơn thời gian kết thúc!");
        return;
    }

    try {
        const data = await fetchHistoryDataFromFirebase();

        if (!data) {
            originalHistoryData = [];
            currentHistoryData = [];
            displayHistoryTable([]);
            return;
        }

        let records = Object.keys(data)
            .map(key => normalizeRecord(data[key], key))
            .filter(r => r && r.timeMillis && r.timeMillis >= startTime && r.timeMillis <= endTime)
            .sort((a, b) => a.timeMillis - b.timeMillis);

        originalHistoryData = records.map(r => ({
            ...r,
            isOutlier: false
        }));

        currentHistoryData = originalHistoryData.map(r => ({ ...r }));

        if (showOutliersOnly) {
            applyOutlierFilter();
        } else {
            sortHistory(currentSort.column, currentSort.direction);
        }

    } catch (error) {
        console.error("Lỗi tải lịch sử:", error);
        alert("Lỗi kết nối Firebase.");
    }
}

function applyOutlierFilter() {
    if (!originalHistoryData.length) {
        currentHistoryData = [];
        displayHistoryTable([]);
        return;
    }

    if (showOutliersOnly) {
        currentHistoryData = originalHistoryData.filter(r => r.isOutlier === true);
    } else {
        currentHistoryData = originalHistoryData.map(r => ({ ...r }));
    }

    sortHistory(currentSort.column, currentSort.direction);
}

function displayHistoryTable(records) {
    const tbody = document.getElementById("historyTableBody");

    if (!tbody) return;

    if (records.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center py-4 text-muted">
                    Không có dữ liệu trong khoảng thời gian này
                </td>
            </tr>
        `;
        return;
    }

    let html = "";

    records.forEach(record => {
        const colorClass = getAQIColorClass(record.aqi);
        const warning = record.status || getAQIWarning(record.aqi);
        const displayMode = record.mode === "auto" ? "Tự động" : (record.mode === "on" || record.mode === "manual" ? "Bật thủ công" : "Tắt thủ công");

        html += `
            <tr>
                <td>${record.timestamp || moment(record.timeMillis).format("YYYY-MM-DD HH:mm:ss")}</td>
                <td>${record.temperature.toFixed(1)}</td>
                <td>${record.humidity.toFixed(1)}</td>
                <td>${record.pm25.toFixed(1)}</td>
                <td><span class="aqi-indicator ${colorClass}"></span> ${record.aqi}</td>
                <td>${warning}</td>
                <td>${record.fan ? "Bật" : "Tắt"}</td>
                <td>${displayMode}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

// ========== SẮP XẾP ==========
function sortHistory(column, direction) {
    if (!currentHistoryData.length) {
        displayHistoryTable([]);
        return;
    }

    const sorted = [...currentHistoryData];

    sorted.sort((a, b) => {
        let valA;
        let valB;

        switch (column) {
            case "time":
                valA = a.timeMillis;
                valB = b.timeMillis;
                break;

            case "temp":
                valA = a.temperature;
                valB = b.temperature;
                break;

            case "humi":
                valA = a.humidity;
                valB = b.humidity;
                break;

            case "dust":
                valA = a.pm25;
                valB = b.pm25;
                break;

            case "aqi":
                valA = a.aqi;
                valB = b.aqi;
                break;

            case "warning":
                valA = a.status;
                valB = b.status;
                break;

            default:
                return 0;
        }

        if (direction === "asc") {
            return valA > valB ? 1 : valA < valB ? -1 : 0;
        } else {
            return valA < valB ? 1 : valA > valB ? -1 : 0;
        }
    });

    currentHistoryData = sorted;
    displayHistoryTable(sorted);
    updateSortIcons(column, direction);
}

function initSortHandlers() {
    const headers = document.querySelectorAll("#historyTable th");

    headers.forEach(th => {
        th.addEventListener("click", () => {
            const column = th.getAttribute("data-sort-key");

            if (!column) return;

            if (currentSort.column === column) {
                currentSort.direction = currentSort.direction === "asc" ? "desc" : "asc";
            } else {
                currentSort.column = column;
                currentSort.direction = "asc";
            }

            sortHistory(currentSort.column, currentSort.direction);
        });
    });
}

function updateSortIcons(activeColumn, direction) {
    const headers = document.querySelectorAll("#historyTable th");

    headers.forEach(th => {
        const icon = th.querySelector("i");

        if (!icon) return;

        const column = th.getAttribute("data-sort-key");

        if (column === activeColumn) {
            icon.className = direction === "asc" ? "fas fa-sort-up" : "fas fa-sort-down";
        } else {
            icon.className = "fas fa-sort";
        }
    });
}

// ========== XUẤT EXCEL ==========
function exportToExcel() {
    if (currentHistoryData.length === 0) {
        alert("Không có dữ liệu!");
        return;
    }

    const excelData = currentHistoryData.map(record => {
        return {
            "Thời gian": record.timestamp || moment(record.timeMillis).format("YYYY-MM-DD HH:mm:ss"),
            "Nhiệt độ (°C)": record.temperature.toFixed(1),
            "Độ ẩm (%)": record.humidity.toFixed(1),
            "PM2.5 (µg/m³)": record.pm25.toFixed(1),
            "AQI": record.aqi,
            "Cảnh báo": record.status,
            "Thiết bị quạt": record.fan ? "Bật" : "Tắt",
            "Chế độ": record.mode === "auto" ? "Tự động" : "Thủ công"
        };
    });

    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb, ws, "Lich su khong khi");
    XLSX.writeFile(wb, `smart_air_history_${moment().format("YYYYMMDD_HHmm")}.xlsx`);
}

// ========== LỌC NHIỄU ==========
function filterOutliers(data, windowSize = 3, threshold = 3) {
    if (data.length <= windowSize) return data.slice();

    const filtered = [];

    for (let i = 0; i < windowSize; i++) {
        filtered.push(data[i]);
    }

    for (let i = windowSize; i < data.length; i++) {
        const recent = data.slice(i - windowSize, i);
        const avg = recent.reduce((a, b) => a + b, 0) / windowSize;

        if (avg !== 0 && (data[i] > avg * threshold || data[i] < avg / threshold)) {
            filtered.push(avg);
        } else {
            filtered.push(data[i]);
        }
    }

    return filtered;
}

// ========== ĐIỀU KHIỂN THIẾT BỊ ==========
async function loadControlSettings() {
    try {
        const control = await fetchControlData();

        if (!control) return;

        const modeSelect = document.getElementById("modeSelect");
        const fanSelect = document.getElementById("fanSelect");
        const pm25Threshold = document.getElementById("pm25Threshold");
        const aqiThreshold = document.getElementById("aqiThreshold");

        if (modeSelect) modeSelect.value = control.mode || "auto";
        if (fanSelect) fanSelect.value = control.fan ? "true" : "false";
        if (pm25Threshold) pm25Threshold.value = control.pm25Threshold ?? 35;
        if (aqiThreshold) aqiThreshold.value = control.aqiThreshold ?? 100;

    } catch (error) {
        console.error("Lỗi load control:", error);
    }
}

async function saveControlSettings() {
    const modeSelect = document.getElementById("modeSelect");
    const fanSelect = document.getElementById("fanSelect");
    const pm25Threshold = document.getElementById("pm25Threshold");
    const aqiThreshold = document.getElementById("aqiThreshold");

    const controlData = {
        mode: modeSelect ? modeSelect.value : "auto",
        fan: fanSelect ? fanSelect.value === "true" : false,
        pm25Threshold: pm25Threshold ? Number(pm25Threshold.value) : 35,
        aqiThreshold: aqiThreshold ? Number(aqiThreshold.value) : 100
    };

    try {
        await updateControlData(controlData);
        alert("Đã lưu điều khiển!");
    } catch (error) {
        console.error("Lỗi lưu control:", error);
        alert("Không thể lưu điều khiển!");
    }
}

// ========== DỰ ĐOÁN AQI BẰNG HỒI QUY TUYẾN TÍNH ==========
async function runPrediction() {
    if (!currentHistoryData || currentHistoryData.length < 2) {
        alert("⚠️ Không có đủ dữ liệu lịch sử để dự đoán! Vui lòng chọn mốc thời gian và bấm 'Tra cứu' trước, hệ thống cần ít nhất 2 bản ghi lịch sử làm mẫu học.");
        return;
    }

    // Sao chép dữ liệu và sắp xếp tăng dần theo trục thời gian X
    const data = [...currentHistoryData].sort((a, b) => a.timeMillis - b.timeMillis);
    const startTime = data[0].timeMillis; // Gốc tọa độ X = 0

    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    const n = data.length;

    data.forEach(point => {
        const x = (point.timeMillis - startTime) / 60000; // Quy đổi thời gian thành Phút (trục X)
        const y = point.aqi; // Chỉ số AQI thực tế (trục Y)
        
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumXX += x * x;
    });

    const denominator = (n * sumXX - sumX * sumX);
    if (denominator === 0) {
        alert("⚠️ Khoảng cách thời gian các bản ghi bằng 0, không thể thực hiện thuật toán chia!");
        return;
    }

    // Tính hệ số góc m và hệ số tự do b (y = mx + b)
    const m = (n * sumXY - sumX * sumY) / denominator;
    const b = (sumY - m * sumX) / n;

    // Lấy vị trí thời gian của phần tử cuối cùng rồi cộng thêm 30 phút để dự đoán tương lai
    const lastTimeX = (data[data.length - 1].timeMillis - startTime) / 60000;
    const predictX = lastTimeX + 30;
    
    let predictedAQI = Math.round(m * predictX + b);

    // Chuẩn hóa khoảng dữ liệu AQI hợp lệ
    if (predictedAQI < 0) predictedAQI = 0;
    if (predictedAQI > 500) predictedAQI = 500;

    let warning = "Không xác định";
    if (predictedAQI <= 50) warning = "Tốt (Không ảnh hưởng sức khỏe)";
    else if (predictedAQI <= 100) warning = "Trung bình (Chấp nhận được)";
    else if (predictedAQI <= 150) warning = "Kém (Nhóm nhạy cảm cần lưu ý)";
    else if (predictedAQI <= 200) warning = "Xấu (Ảnh hưởng sức khỏe chung)";
    else if (predictedAQI <= 300) warning = "Rất xấu (Cảnh báo sức khỏe hệ hô hấp)";
    else warning = "Nguy hại (Khẩn cấp về sức khỏe)";

    alert(`📈 KẾT QUẢ DỰ ĐOÁN AQI (HỒI QUY TUYẾN TÍNH)\n\n` +
          `- Số lượng bản ghi đã học (n): ${n} bản ghi.\n` +
          `- Thời gian dự đoán: 30 phút tiếp theo\n\n` +
          `👉 Chỉ số AQI dự báo: ${predictedAQI}\n` +
          `👉 Đánh giá môi trường: ${warning}\n\n` +
          `(Mô hình Toán học: y = ${m.toFixed(4)}x + ${b.toFixed(2)})`);
}

// ========== KHỞI TẠO ==========
document.addEventListener("DOMContentLoaded", function () {
    loadConfigFromStorage();

    const firebaseHostInput = document.getElementById("firebaseHost");
    const firebaseAuthInput = document.getElementById("firebaseAuth");
    const firebasePathInput = document.getElementById("firebasePath");

    if (firebaseHostInput) firebaseHostInput.value = firebaseHost;
    if (firebaseAuthInput) firebaseAuthInput.value = firebaseAuth;
    if (firebasePathInput) firebasePathInput.value = firebasePath;

    setDefaultHistoryTimes();
    setDefaultCustomTimes();

    loadCurrentData(3);
    loadControlSettings();

    const historyForm = document.getElementById("historyForm");
    if (historyForm) {
        historyForm.addEventListener("submit", function (e) {
            e.preventDefault();
            loadHistoryData();
        });
    }

    const configForm = document.getElementById("configForm");
    if (configForm) {
        configForm.addEventListener("submit", function (e) {
            e.preventDefault();

            if (saveConfig()) {
                loadCurrentData(3);
                loadControlSettings();
            }
        });
    }

    const exportExcelBtn = document.getElementById("exportExcelBtn");
    if (exportExcelBtn) {
        exportExcelBtn.addEventListener("click", exportToExcel);
    }

    const smoothToggle = document.getElementById("smoothToggle");
    if (smoothToggle) {
        smoothToggle.addEventListener("change", function (e) {
            smoothingEnabled = e.target.checked;

            if (currentChartMode === "custom" && customStartTime && customEndTime) {
                loadDataForChart(customStartTime, customEndTime);
            } else if (currentChartMode === "6h") {
                loadCurrentData(6);
            } else {
                loadCurrentData(3);
            }
        });
    }

    const noiseToggle = document.getElementById("noiseFilterToggle");
    if (noiseToggle) {
        noiseToggle.addEventListener("change", function (e) {
            noiseFilterEnabled = e.target.checked;

            if (currentChartMode === "custom" && customStartTime && customEndTime) {
                loadDataForChart(customStartTime, customEndTime);
            } else if (currentChartMode === "6h") {
                loadCurrentData(6);
            } else {
                loadCurrentData(3);
            }
        });
    }

    const outliersOnlyToggle = document.getElementById("showOutliersOnlyToggle");
    if (outliersOnlyToggle) {
        outliersOnlyToggle.addEventListener("change", function (e) {
            showOutliersOnly = e.target.checked;
            applyOutlierFilter();
        });
    }

    initSortHandlers();

    // Auto refresh.
    // Lưu ý: nếu đang ở chế độ Tùy chỉnh thì không tự ghi đè biểu đồ nữa.
    setInterval(() => {
        const currentTab = document.getElementById("current-tab");

        if (!currentTab || !currentTab.classList.contains("active")) {
            return;
        }

        if (currentChartMode === "custom") {
            return;
        }

        if (currentChartMode === "6h") {
            loadCurrentData(6);
        } else {
            loadCurrentData(3);
        }
    }, 30000);
});