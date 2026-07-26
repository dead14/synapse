const { generateTemplateWorkbook } = require('./templateGenerator');

exports.downloadTemplate = async (req, res) => {
    try {
        const buffer = await generateTemplateWorkbook();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="ILI_Template.xlsx"');
        return res.send(buffer);
    } catch (error) {
        console.error('Failed to create ILI template:', error);
        return res.status(500).json({ error: 'Failed to create ILI template' });
    }
};
