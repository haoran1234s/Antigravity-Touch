import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const runtimeHomedir = (): string => eval('require')('os').homedir();
const getBrainDir = () => path.join(runtimeHomedir(), '.gemini', 'antigravity', 'brain');

/**
 * GET /api/v1/artifacts — list all conversation directories with artifact files.
 */
export async function GET() {
  try {
    if (!fs.existsSync(getBrainDir())) {
      return NextResponse.json({ artifacts: [] });
    }

    const dirs = fs
      .readdirSync(getBrainDir(), { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => {
        const dirPath = path.join(getBrainDir(), d.name);
        try {
          const files = fs
            .readdirSync(dirPath)
            .filter(
              (f) =>
                !f.startsWith('.') &&
                fs.statSync(path.join(dirPath, f)).isFile()
            );
          return { id: d.name, fileCount: files.length };
        } catch {
          return { id: d.name, fileCount: 0 };
        }
      })
      .filter((d) => d.fileCount > 0);

    return NextResponse.json({ artifacts: dirs });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
