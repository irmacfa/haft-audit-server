// Merge every sheet of the IT material export into one selectable catalog.
// Run: node scripts/build-material-catalog.js "C:\path\to\IT_MATERIAL.xlsx"
// The generated file is tracked in catalog/materials.json; no runtime DB is touched.
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const file = process.argv[2];
if (!file) {
    console.error('Usage: node scripts/build-material-catalog.js "path\\to\\IT_MATERIAL.xlsx"');
    process.exit(1);
}
const source = path.resolve(file);
if (!fs.existsSync(source)) {
    console.error('File not found:', source);
    process.exit(1);
}

const wb = XLSX.readFile(source);
const byMaterial = new Map();
const sheets = [];
const warnings = [];

for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
    if (!rows.length) continue;
    const header = rows[0].map(h => String(h == null ? '' : h).trim());
    // Each export sheet has its own column order, so locate the columns by name.
    const materialIdx = header.indexOf('Material');
    const descIdx = header.indexOf('Material Description');
    if (materialIdx < 0 || descIdx < 0) {
        warnings.push(`Sheet "${sheetName}" skipped: Material or Material Description column missing.`);
        continue;
    }
    let added = 0;
    for (const row of rows.slice(1)) {
        const material = String(row[materialIdx] == null ? '' : row[materialIdx]).trim();
        const description = String(row[descIdx] == null ? '' : row[descIdx]).trim();
        if (!material && !description) continue;
        if (!material || !description) {
            warnings.push(`Sheet "${sheetName}": row with incomplete material data skipped.`);
            continue;
        }
        if (byMaterial.has(material)) {
            const existing = byMaterial.get(material);
            if (existing.description !== description) {
                warnings.push(`Duplicate code ${material}: kept first description.`);
            }
            continue;
        }
        byMaterial.set(material, { material, description });
        added++;
    }
    sheets.push({ name: sheetName, rows: added });
}

const items = [...byMaterial.values()].sort((a, b) =>
    String(a.material).localeCompare(String(b.material), 'en', { numeric: true })
);

const outputDir = path.join(__dirname, '..', 'catalog');
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
const outputPath = path.join(outputDir, 'materials.json');
fs.writeFileSync(outputPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    sourceSheets: sheets,
    count: items.length,
    items
}, null, 2) + '\n');

console.log(JSON.stringify({
    output: path.relative(process.cwd(), outputPath),
    sourceSheets: sheets,
    count: items.length,
    warnings: warnings.slice(0, 20),
    warningCount: warnings.length
}, null, 2));
