#!/usr/bin/env node
// 生成任务栏角标的 X。
//
// 角标就是标里那个 X 本体：主体图标（src-tauri/icons/icon_no_x.png）不带 X，
// 由任务栏角标按未读状态画白 X 或红 X。
//
// 权属：这个角标里只有 VRCX-0 自己的 X 字形（由 Arial Black 字形转成的路径），
// 不含联名标里属于星遇同频（VRCC）的气泡与 #。所以它是 VRCX-0 自有素材，
// 与 images/brand/Galaxy/ 下那张联名标的授权范围无关。
//
// 形状直接从 images/brand/Galaxy/VRCX-0-Galaxies.svg 里那条 path 抄过来，
// 不重新手绘，标里的 X 改了这个脚本跟着改。
//
// 用法（在仓库根执行）：
//   node scripts/generate-taskbar-badge.mjs
//
// 依赖最简 SVG 渲染器；本机用 resvg 的 Python 绑定，换成任何能按尺寸
// 光栅化 SVG 的工具都可以，输出文件名与尺寸表保持下方一致即可。

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const OUT = resolve(root, 'crates/host-desktop/assets/badge');

// 与 VRCX-0-Galaxies.svg 里那条 X 完全一致的 path
const X_PATH =
    'M382.17 121.36L340.84 58.29L385.67 58.29L409.03 98.81L431.67 58.29' +
    'L476.06 58.29L435.09 122.08L479.92 190L434.19 190L408.22 147.68' +
    'L382.17 190L336.71 190L382.17 121.36Z';

const STROKE = '#2a2a6a';
const STROKE_WIDTH = 16;
const RAW = { x0: 336.71, y0: 58.29, x1: 479.92, y1: 190.0 };

// 角标画布固定 512，与主体图标同一坐标系，方便按比例摆放
const CANVAS = 512;
// X 含描边后的线性尺寸占画布的比例
const FILL = 0.43;
// X 中心落在画布的相对位置
const AX = 0.617;
const AY = 0.66;

const HALF = STROKE_WIDTH / 2;
const x0 = RAW.x0 - HALF;
const y0 = RAW.y0 - HALF;
const x1 = RAW.x1 + HALF;
const y1 = RAW.y1 + HALF;
const gw = x1 - x0;
const gh = y1 - y0;

const boxW = gw / FILL;
const boxH = gh / FILL;
const vx = AX * CANVAS - boxW / 2;
const vy = AY * CANVAS - boxH / 2;
const sx = boxW / gw;
const sy = boxH / gh;

const SIZES = [16, 20, 24, 28, 32, 40, 48, 64];
const STATES = { active: '#F43F3F', idle: '#ffffff' };

const svgFor = (fill) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}">` +
    `<g transform="translate(${vx.toFixed(2)} ${vy.toFixed(2)}) ` +
    `scale(${sx.toFixed(6)} ${sy.toFixed(6)}) ` +
    `translate(${(-x0).toFixed(2)} ${(-y0).toFixed(2)})">` +
    `<path d="${X_PATH}" fill="${fill}" stroke="${STROKE}" ` +
    `stroke-width="${STROKE_WIDTH}" stroke-linejoin="round" paint-order="stroke"/>` +
    `</g></svg>`;

mkdirSync(OUT, { recursive: true });

for (const [state, fill] of Object.entries(STATES)) {
    const svg = svgFor(fill);
    writeFileSync(resolve(OUT, `badge-x-${state}.svg`), svg);

    for (const size of SIZES) {
        const png = execFileSync(
            'python',
            [
                '-c',
                'import sys,resvg_py;' +
                    'sys.stdout.buffer.write(resvg_py.svg_to_bytes(' +
                    'svg_string=sys.stdin.read(), width=int(sys.argv[1]), height=int(sys.argv[1])))',
                String(size)
            ],
            { input: svg, cwd: root, maxBuffer: 1 << 20 }
        );
        writeFileSync(resolve(OUT, `badge-x-${state}-${size}.png`), png);
    }
}

console.log(`badge written to ${OUT}`);
console.log(
    `sizes: ${SIZES.join(', ')}  states: ${Object.keys(STATES).join(', ')}`
);
