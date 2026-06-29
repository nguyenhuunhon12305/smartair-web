let tempChart, humiChart, dustChart, aqiChart;

function smoothArray(arr, windowSize) {
  if (arr.length < windowSize) return arr.slice();
  const half = Math.floor(windowSize / 2);
  const smoothed = new Array(arr.length);

  for (let i = 0; i < arr.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j >= 0 && j < arr.length) {
        sum += arr[j];
        count++;
      }
    }
    smoothed[i] = sum / count;
  }

  return smoothed;
}

function createSingleChart(canvasId, label, data, borderColor, bgColor, title, beginAtZero) {
  const ctx = document.getElementById(canvasId).getContext("2d");
  return new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [{
        label,
        data,
        borderColor,
        backgroundColor: bgColor,
        tension: 0,
        borderWidth: 2,
        pointRadius: 3,
        pointHoverRadius: 5,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: title },
        legend: { display: true }
      },
      scales: {
        y: { beginAtZero },
        x: { ticks: { maxRotation: 25, minRotation: 25, maxTicksLimit: 8 } }
      }
    }
  });
}

function renderCharts(labels, tempData, humiData, pm25Data, aqiData) {
  if (tempChart) tempChart.destroy();
  if (humiChart) humiChart.destroy();
  if (dustChart) dustChart.destroy();
  if (aqiChart) aqiChart.destroy();

  tempChart = createSingleChart("tempChart", "Nhiệt độ (°C)", tempData, "#e74c3c", "rgba(231,76,60,0.12)", "Nhiệt độ", false);
  humiChart = createSingleChart("humiChart", "Độ ẩm (%)", humiData, "#3498db", "rgba(52,152,219,0.12)", "Độ ẩm", false);
  dustChart = createSingleChart("dustChart", "PM2.5 (µg/m³)", pm25Data, "#f39c12", "rgba(243,156,18,0.12)", "Bụi PM2.5", true);
  aqiChart = createSingleChart("aqiChart", "AQI", aqiData, "#27ae60", "rgba(39,174,96,0.12)", "Chỉ số AQI", true);

  tempChart.data.labels = labels;
  humiChart.data.labels = labels;
  dustChart.data.labels = labels;
  aqiChart.data.labels = labels;

  tempChart.update();
  humiChart.update();
  dustChart.update();
  aqiChart.update();
}
