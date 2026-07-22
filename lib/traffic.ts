import ExcelJS from "exceljs";
import { DeckError, parseCsvMatrix, parseTrafficMatrix } from "./lcr2";

function excelCellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if ("result" in value && value.result !== undefined) return excelCellText(value.result);
  if ("text" in value) return value.text;
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  return "";
}

export async function parseTrafficUpload(file: File) {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".csv")) return parseTrafficMatrix(parseCsvMatrix(await file.text()));
  if (!lowerName.endsWith(".xlsx")) throw new DeckError("The current traffic file must be an Excel .xlsx file or CSV.");

  const workbook = new ExcelJS.Workbook();
  try {
    const workbookBytes = Buffer.from(await file.arrayBuffer());
    await workbook.xlsx.load(workbookBytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    throw new DeckError("The current traffic Excel file could not be read.");
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new DeckError("The current traffic Excel workbook has no worksheets.");
  const matrix: string[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const width = Math.max(worksheet.columnCount, row.cellCount);
    matrix.push(Array.from({ length: width }, (_, index) => excelCellText(row.getCell(index + 1).value).trim()));
  });
  return parseTrafficMatrix(matrix);
}
