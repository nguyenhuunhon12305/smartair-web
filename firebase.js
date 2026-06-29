// firebase.js - Đọc/ghi Firebase theo cấu trúc air_quality/current, history, control

function buildFirebaseUrl(path) {
  const baseUrl = firebaseHost.replace(/\/$/, "");
  const cleanPath = path.replace(/^\/+/, "");
  let url = `${baseUrl}/${cleanPath}.json`;

  if (firebaseAuth && firebaseAuth.trim() !== "") {
    url += `?auth=${encodeURIComponent(firebaseAuth)}`;
  }

  return url;
}

async function fetchJson(path) {
  const url = buildFirebaseUrl(path);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP error ${response.status}`);
  }

  setConnectionOK();
  return await response.json();
}

async function patchJson(path, payload) {
  const url = buildFirebaseUrl(path);
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`HTTP error ${response.status}`);
  }

  setConnectionOK();
  return await response.json();
}

async function fetchCurrentData() {
  try {
    return await fetchJson(`${firebasePath}/current`);
  } catch (error) {
    setConnectionLost();
    console.error("Lỗi lấy current:", error);
    throw error;
  }
}

async function fetchHistoryDataFromFirebase() {
  try {
    return await fetchJson(`${firebasePath}/history`);
  } catch (error) {
    setConnectionLost();
    console.error("Lỗi lấy history:", error);
    throw error;
  }
}

async function fetchControlData() {
  try {
    return await fetchJson(`${firebasePath}/control`);
  } catch (error) {
    setConnectionLost();
    console.error("Lỗi lấy control:", error);
    throw error;
  }
}

async function updateControlData(controlData) {
  try {
    return await patchJson(`${firebasePath}/control`, controlData);
  } catch (error) {
    setConnectionLost();
    console.error("Lỗi ghi control:", error);
    throw error;
  }
}

function setConnectionOK() {
  const status = document.getElementById("connectionStatus");
  if (!status) return;

  status.innerHTML = '<i class="fas fa-plug me-1"></i>Đã kết nối';
  status.classList.add("bg-success");
  status.classList.remove("bg-danger");
}

function setConnectionLost() {
  const status = document.getElementById("connectionStatus");
  if (!status) return;

  status.innerHTML = '<i class="fas fa-exclamation-triangle me-1"></i>Mất kết nối';
  status.classList.remove("bg-success");
  status.classList.add("bg-danger");
}
