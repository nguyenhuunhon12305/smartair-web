// config.js - Cấu hình Firebase cho hệ thống điều hòa không khí thông minh

const DEFAULT_FIREBASE_HOST = "https://smart-air-system-132aa-default-rtdb.firebaseio.com/";
const DEFAULT_FIREBASE_AUTH = "";
const DEFAULT_FIREBASE_PATH = "air_quality";

let firebaseHost = DEFAULT_FIREBASE_HOST;
let firebaseAuth = DEFAULT_FIREBASE_AUTH;
let firebasePath = DEFAULT_FIREBASE_PATH;

function loadConfigFromStorage() {
  const storedHost = localStorage.getItem("firebaseHost");
  const storedAuth = localStorage.getItem("firebaseAuth");
  const storedPath = localStorage.getItem("firebasePath");

  if (storedHost) firebaseHost = storedHost;
  if (storedAuth !== null) firebaseAuth = storedAuth;
  if (storedPath !== null) firebasePath = storedPath;
}

function saveConfig() {
  const newHost = document.getElementById("firebaseHost").value.trim();
  const newAuth = document.getElementById("firebaseAuth").value.trim();
  const newPath = document.getElementById("firebasePath").value.trim();

  if (!newHost) {
    alert("Vui lòng nhập Firebase Host!");
    return false;
  }

  firebaseHost = newHost.endsWith("/") ? newHost : newHost + "/";
  firebaseAuth = newAuth;
  firebasePath = newPath || "air_quality";

  localStorage.setItem("firebaseHost", firebaseHost);
  localStorage.setItem("firebaseAuth", firebaseAuth);
  localStorage.setItem("firebasePath", firebasePath);

  setConnectionOK();
  return true;
}

function resetToDefaultConfig() {
  firebaseHost = DEFAULT_FIREBASE_HOST;
  firebaseAuth = DEFAULT_FIREBASE_AUTH;
  firebasePath = DEFAULT_FIREBASE_PATH;

  document.getElementById("firebaseHost").value = firebaseHost;
  document.getElementById("firebaseAuth").value = firebaseAuth;
  document.getElementById("firebasePath").value = firebasePath;

  localStorage.setItem("firebaseHost", firebaseHost);
  localStorage.setItem("firebaseAuth", firebaseAuth);
  localStorage.setItem("firebasePath", firebasePath);

  alert("Đã khôi phục cấu hình mặc định cho hệ thống!");
}
