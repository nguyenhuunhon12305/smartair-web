// ui.js - Các hàm tiện ích giao diện và tính toán AQI

// Hiển thị thông báo nhanh (toast)
function showToast(type, message) {
    const toast = document.createElement('div');
    toast.className = `alert alert-${type} position-fixed top-0 end-0 m-3`;
    toast.style.zIndex = '9999';
    toast.innerText = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// Định dạng ngày giờ cho input datetime-local
function formatDateTimeLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// Đặt thời gian mặc định cho form lịch sử (24h trước)
function setDefaultHistoryTimes() {
    const end = new Date();
    const start = new Date(end.getTime() - 24 * 3600 * 1000);
    document.getElementById('startDateTime').value = formatDateTimeLocal(start);
    document.getElementById('endDateTime').value = formatDateTimeLocal(end);
}

// Đặt thời gian mặc định cho modal tùy chỉnh
function setDefaultCustomTimes() {
    const end = new Date();
    const start = new Date(end.getTime() - 24 * 3600 * 1000);
    document.getElementById('customStart').value = formatDateTimeLocal(start);
    document.getElementById('customEnd').value = formatDateTimeLocal(end);
}

// Tính chỉ số AQI từ nồng độ PM2.5 (µg/m³)
function calculateAQI(pm25) {
    if (pm25 <= 12.0) return Math.round((50/12) * pm25);
    else if (pm25 <= 35.4) return Math.round(((100-51)/(35.4-12.1)) * (pm25 - 12.1) + 51);
    else if (pm25 <= 55.4) return Math.round(((150-101)/(55.4-35.5)) * (pm25 - 35.5) + 101);
    else if (pm25 <= 150.4) return Math.round(((200-151)/(150.4-55.5)) * (pm25 - 55.5) + 151);
    else if (pm25 <= 250.4) return Math.round(((300-201)/(250.4-150.5)) * (pm25 - 150.5) + 201);
    else if (pm25 <= 350.4) return Math.round(((400-301)/(350.4-250.5)) * (pm25 - 250.5) + 301);
    else if (pm25 <= 500.4) return Math.round(((500-401)/(500.4-350.5)) * (pm25 - 350.5) + 401);
    else return 500;
}

// Lấy cảnh báo theo AQI
function getAQIWarning(aqi) {
    if (aqi <= 50) return 'Không ảnh hưởng';
    else if (aqi <= 100) return 'Ảnh hưởng không đáng kể';
    else if (aqi <= 150) return 'Nhóm nhạy cảm nên hạn chế ra ngoài';
    else if (aqi <= 200) return 'Mọi người nên hạn chế hoạt động ngoài trời';
    else if (aqi <= 300) return 'Cảnh báo sức khỏe: tránh ra ngoài';
    else return 'Khẩn cấp: ở trong nhà, đóng cửa';
}

// Lấy class màu cho indicator AQI
function getAQIColorClass(aqi) {
    if (aqi <= 50) return 'aqi-good';
    else if (aqi <= 100) return 'aqi-moderate';
    else if (aqi <= 150) return 'aqi-unhealthy-sensitive';
    else if (aqi <= 200) return 'aqi-unhealthy';
    else if (aqi <= 300) return 'aqi-very-unhealthy';
    else return 'aqi-hazardous';
}