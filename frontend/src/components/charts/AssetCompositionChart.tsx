import Chart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";

export default function AssetCompositionChart() {
  const options: ApexOptions = {
    colors: ["#219653", "#FFA70B", "#D34053"], // Healthy, Monitor, Critical
    labels: ["Healthy", "Monitor", "Critical"],
    chart: {
      fontFamily: "Outfit, sans-serif",
      type: "donut",
      width: 445,
      height: 290,
    },
    plotOptions: {
      pie: {
        donut: {
          size: "65%",
          background: "transparent",
          labels: {
            show: true,
            value: {
              show: true,
              offsetY: 0,
            },
          },
        },
      },
    },
    states: {
      hover: {
        filter: {
          type: "none",
        },
      },
      active: {
        allowMultipleDataPointsSelection: false,
        filter: {
          type: "darken",
        },
      },
    },
    dataLabels: {
      enabled: true,
    },
    tooltip: {
      enabled: true,
    },
    stroke: {
      show: false,
      width: 4, // Creates a gap between the series
    },

    legend: {
      show: true,
      position: "bottom",
      horizontalAlign: "center",
      fontFamily: "Outfit",
      fontSize: "14px",
      fontWeight: 400,
      markers: {
        size: 4,
        shape: "circle",

        strokeWidth: 0,
      },
      itemMargin: {
        horizontal: 10,
        vertical: 0,
      },
    },

    responsive: [
      {
        breakpoint: 640,
        options: {
          chart: {
            width: 370,
            height: 290,
          },
        },
      },
    ],
  };
  const series = [60, 25, 15];
  return (
    <div className="flex justify-center">
      <div id="chartDarkStyle">
        <Chart options={options} series={series} type="donut" height={290} />
      </div>
    </div>
  );
}
