#!/usr/bin/env node
// 生成任务栏角标的 X。
//
// 角标是标里那个 X 的复制品：图标本身已经带一个白 X（全项目不存在「不带 X」
// 的版本），角标在无未读时画白 X 与原图重合，有未读时画红 X 盖住它。
// 所以角标的形状、大小、位置必须与图标里那个 X 对齐，偏一点就露出白边。
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
// X 含描边后的线性尺寸占画布的比例。
// 图标本身已经带一个白 X，角标要盖在它上面，所以尺寸按那个白 X 定。
const FILL = 0.43;
// X 中心落在画布的相对位置。
//
// 以下三个数是 2560×1600、任务栏 32px 图标下实测反推的：
//   角标画布      x 1787..1809  y 1536..1558   23 × 23
//   图标里的白 X   x 1785..1797  y 1551..1560   13 × 10，中心 (1791, 1555.5)
// 白 X 的左沿比画布左沿还左 2px，那是抗锯齿边缘。红色角标连同它自己的
// #2a2a6a 描边画上去之后这层边缘基本被压没，实测该区域无残留白像素。
// 换 DPI、任务栏尺寸或缩放比例后需要重测。
const AX = 0.332;
const AY = 0.774;

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
