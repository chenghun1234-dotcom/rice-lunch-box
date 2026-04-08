/**
 * preview-csv.js — scripts/preview-csv.js
 *
 * Supabase/카카오 키 없이 CSV 파싱 결과만 미리 확인
 * node preview-csv.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, "../data/raw/행정안전부_착한가격업소 현황_20250930.csv");

const FOOD_CATEGORIES = ["한식","양식","중식","일식","분식","기타요식업","요식업","음식","식당","카페","제과","패스트푸드","뷔페","도시락","치킨","피자","족발","국밥"];
function isFood(cat) { return !cat || FOOD_CATEGORIES.some(f => cat.includes(f)); }

function parseLine(line) {
  const cells=[]; let cur="", inQ=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(c==='"'){ if(inQ&&line[i+1]==='"'){cur+='"';i++;}else inQ=!inQ; }
    else if(c===','&&!inQ){ cells.push(cur.trim()); cur=""; }
    else cur+=c;
  }
  cells.push(cur.trim()); return cells;
}

const buf = fs.readFileSync(CSV_PATH);
const text = new TextDecoder("euc-kr").decode(buf);
const lines = text.split(/\r?\n/).filter(Boolean);
const headers = parseLine(lines[0]);

console.log("\n📋 컬럼:", headers.join(" | "));
console.log(`📊 총 데이터 행: ${lines.length - 1}행\n`);

// 통계
let food=0, nonFood=0, noCoord=0;
const byCategory={}, bySido={};

for(const line of lines.slice(1)){
  const cells = parseLine(line);
  const row = {};
  headers.forEach((h,i)=>{ row[h]=cells[i]??''; });

  const cat  = row["업종"]?.trim();
  const sido = row["시도"]?.trim();
  const name = row["업소명"]?.trim();
  const addr = row["주소"]?.trim();

  if(isFood(cat)){ food++; } else { nonFood++; continue; }

  byCategory[cat] = (byCategory[cat]||0)+1;
  bySido[sido]    = (bySido[sido]||0)+1;
}

console.log(`✅ 요식업 업소: ${food}개`);
console.log(`⏭️  비요식업 제외: ${nonFood}개\n`);

console.log("📍 시도별 분포:");
Object.entries(bySido).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>
  console.log(`   ${k}: ${v}개`)
);

console.log("\n🍽️  업종별 분포 (상위 15):");
Object.entries(byCategory).sort((a,b)=>b[1]-a[1]).slice(0,15).forEach(([k,v])=>
  console.log(`   ${k}: ${v}개`)
);

console.log("\n📝 샘플 데이터 (5건):");
let count=0;
for(const line of lines.slice(1)){
  if(count>=5) break;
  const cells=parseLine(line);
  const row={};
  headers.forEach((h,i)=>{ row[h]=cells[i]??''; });
  if(!isFood(row["업종"])) continue;
  console.log(`  [${count+1}] ${row["업소명"]} (${row["업종"]}) | ${row["주소"]?.substring(0,30)}... | ${row["메뉴1"]} ${row["가격1"]}원`);
  count++;
}
console.log("\n→ 이 데이터를 Supabase에 임포트하려면: node import-csv.js\n");
