const xlsx = require('xlsx');

exports.downloadTemplate = (req, res) => {
    const headers = [
        "feature_id", "log_distance_m", "joint_number", "dist_to_us_gw_m", "joint_length_m", "feature_type",
        "feature_identification", "dim_classification", "clock_position", "wall_thickness_mm", "length_mm",
        "width_mm", "depth_pct", "surface_location", "erf_asme", "psafe_bar", "comment"
    ];

    const data = [
        headers,
        [1, 10.5, 1, 0.5, 12.0, "Weld", "", "", "12:00", 10.0, "", "", "", "", "", "", ""],
        [2, 15.2, 1, 5.2, 12.0, "Metal Loss", "Corrosion", "", "03:00", 10.0, 50, 40, 15, "External", "", "", ""],
        [3, 22.5, 2, 10.5, 12.0, "Weld", "", "", "12:00", 10.0, "", "", "", "", "", "", ""],
        [4, 28.4, 2, 4.4, 12.0, "Metal Loss", "Pitting", "", "06:30", 10.0, 20, 20, 35, "Internal", "", "", ""],
        [5, 34.5, 3, 10.5, 12.0, "Weld", "", "", "12:00", 10.0, "", "", "", "", "", "", ""],
        [6, 41.2, 3, 6.7, 12.0, "Tee", "", "", "09:00", 10.0, "", "", "", "", "", "", ""],
        [7, 46.5, 4, 5.3, 12.0, "Metal Loss", "Corrosion", "", "01:15", 10.0, 150, 80, 45, "External", "", "", ""],
        [8, 58.5, 5, 12.0, 12.0, "Weld", "", "", "12:00", 10.0, "", "", "", "", "", "", ""]
    ];

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.aoa_to_sheet(data);

    xlsx.utils.book_append_sheet(wb, ws, "ILI Template");

    const buf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="ILI_Template.xlsx"');
    res.send(buf);
};
