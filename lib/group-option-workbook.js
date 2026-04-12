const workbookData = require('./group-option-workbook-data');

function normalizeLabel(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()\[\]{}+,&/._-]/g, '');
}

function sanitizeValueName(name) {
  let clean = String(name || '').replace(/[^\uAC00-\uD7A3\u3131-\u3163a-zA-Z0-9\-_+/().,\s]/g, '');
  clean = clean.replace(/\s{2,}/g, ' ').trim();
  if (clean.length > 50) clean = clean.substring(0, 50).trim();
  return clean || '기본';
}

function sanitizeOptionalValue(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  return sanitizeValueName(raw);
}

function pickDefaultValue(spo) {
  const values = spo?.optionValues || [];
  if (values.length > 0) return values[0].valueName;
  const units = spo?.optionUsableUnits || [];
  if (units.length > 0) return '1' + units[0].unit;
  const name = String(spo?.optionName || '').toLowerCase();
  if (name.includes('수량') || name.includes('개수')) return '1개';
  // 가이드에 optionValues가 없을 때 '1개'를 용량 축에 넣으면 연관/형식 오류가 잦음
  if (name.includes('용량') || name.includes('중량')) return '50ml';
  return '1개';
}

function getWorkbookCategoryInfo(categoryId) {
  return workbookData[String(categoryId || '').trim()] || null;
}

/** 옵션 라벨 + 상품명(전체) — 향은 옵션, ml/g는 보통 상품명에만 있음 */
function mergeOptionAndProductTokens(optLabel, productTitle) {
  const o = extractTokens(sanitizeValueName(optLabel));
  const p = extractTokens(sanitizeValueName(productTitle || ''));
  return {
    label: o.label,
    measure: o.measure || p.measure,
    size: o.size || p.size,
    count: o.count || p.count,
    bracket: o.bracket || p.bracket,
    composition: o.composition || p.composition,
    generic: o.generic,
  };
}

function extractTokens(rawLabel) {
  const label = String(rawLabel || '').trim();
  const measure = (label.match(/\d+(?:\.\d+)?\s?(?:ml|mL|l|L|g|kg|mg|oz)\b/) || [])[0] || '';
  const size = (label.match(/\d+(?:\.\d+)?\s?(?:호|cm|mm|inch|인치)\b/) || [])[0] || '';
  const count = (label.match(/\d+\s?(?:개|입|종|매|캡슐|정|포|ea|EA)\b/) || [])[0] || '';
  const bracketMatch = label.match(/^\s*[\[(]([^\])]+)[\])]/);
  const bracket = bracketMatch ? String(bracketMatch[1] || '').trim() : '';

  let remainder = label
    .replace(/^\s*[\[(][^\])]+[\])]\s*/g, ' ')
    .replace(/\d+(?:\.\d+)?\s?(?:ml|mL|l|L|g|kg|mg|oz)\b/g, ' ')
    .replace(/\d+\s?(?:개|입|종|매|캡슐|정|ea|EA)\b/g, ' ')
    .replace(/\d+(?:\.\d+)?\s?(?:호|cm|mm|inch|인치)\b/g, ' ')
    .replace(/[+/,]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const composition = bracket || (/(기획|세트|리필|본품|케이스|패키지|에디션|단품|구성)/.test(label) ? remainder || label : '');
  const generic = remainder || bracket || label;

  return {
    label,
    measure: sanitizeOptionalValue(measure),
    size: sanitizeOptionalValue(size),
    count: sanitizeOptionalValue(count),
    bracket: sanitizeOptionalValue(bracket),
    composition: sanitizeOptionalValue(composition),
    generic: sanitizeOptionalValue(generic),
  };
}

function getValueForOptionName(optionName, tokens, fallback) {
  const name = String(optionName || '');

  if (/색상|컬러|색\s|향|scent|aroma/i.test(name)) return tokens.generic || fallback;
  if (/종류\s*수량/.test(name)) return tokens.composition || tokens.bracket || tokens.generic || tokens.count || fallback;
  if (/개당\s*수량/.test(name)) return tokens.count || tokens.measure || fallback;
  if (/(용량|중량|무게)/.test(name)) return tokens.measure || fallback;
  if (/(수량|종류 수량|개당 수량)/.test(name)) return tokens.count || fallback;
  if (/(사이즈|크기|그립사이즈)/.test(name)) return tokens.size || fallback;
  if (/구성/.test(name)) return tokens.composition || tokens.bracket || '';
  if (/종류/.test(name)) return tokens.composition || tokens.generic || '';
  return tokens.generic || fallback;
}

function scoreGuideAgainstWorkbook(guide, workbookInfo, optionLabels, productTitle = '') {
  const names = (guide?.standardPurchaseOptions || []).map((item) => item?.optionName).filter(Boolean);
  const normalizedNames = names.map(normalizeLabel);
  let score = 0;

  const firstOpt = (optionLabels || [])[0] || '';
  const merged = mergeOptionAndProductTokens(firstOpt, productTitle);
  const needsMeasure = names.some((n) => /용량|중량|무게|용량\(/.test(n));
  if (names.length >= 3 && needsMeasure && !merged.measure) {
    score -= 280;
  }

  if (workbookInfo?.combos?.length) {
    for (const combo of workbookInfo.combos) {
      const comboNames = (combo.optionNames || []).map(normalizeLabel);
      if (comboNames.length === normalizedNames.length && comboNames.every((name, idx) => name === normalizedNames[idx])) {
        score += 1000;
      } else if (comboNames.length === normalizedNames.length && comboNames.every((name) => normalizedNames.includes(name))) {
        score += 800;
      }
    }
  }

  score += Math.max(0, 120 - names.length * 20);

  const sampledLabels = (optionLabels || []).slice(0, 5);
  for (const optionName of names) {
    const matchedCount = sampledLabels.filter((label) => {
      const value = getValueForOptionName(optionName, mergeOptionAndProductTokens(label, productTitle), '');
      return Boolean(value);
    }).length;
    score += matchedCount > 0 ? 40 : -20;
  }

  return score;
}

/** 가이드에 제시된 optionValues 중 하나로 맞춤 — 임의 문자열은 연관 속성 오류 유발 */
function snapValueToGuide(candidate, spo) {
  const values = spo?.optionValues || [];
  if (values.length === 0) return sanitizeValueName(candidate);
  const c = String(candidate || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!c) return sanitizeValueName(values[0].valueName);
  for (const v of values) {
    const vn = String(v.valueName || v.minAttributeValue || '').trim();
    if (!vn) continue;
    const n = vn.toLowerCase().replace(/\s+/g, '');
    if (n === c) return sanitizeValueName(vn);
  }
  for (const v of values) {
    const vn = String(v.valueName || '').trim();
    const n = vn.toLowerCase().replace(/\s+/g, '');
    if (n && (c.includes(n) || n.includes(c))) return sanitizeValueName(vn);
  }
  const num = c.match(/\d+(?:\.\d+)?/);
  if (num) {
    for (const v of values) {
      const vn = String(v.valueName || '').trim();
      if (vn.includes(num[0])) return sanitizeValueName(vn);
    }
  }
  return sanitizeValueName(values[0].valueName);
}

/** optionUsableUnits 가 있을 때 값 끝이 허용 단위를 따르도록 (공식 가이드) */
function enforceOptionUsableUnits(valueName, spo) {
  const units = spo?.optionUsableUnits;
  if (!units || !Array.isArray(units) || units.length === 0) return sanitizeValueName(valueName);
  let v = String(valueName || '').trim();
  if (!v) return snapValueToGuide('', spo);
  const unitList = units.map((u) => String(u.unit || '').trim()).filter(Boolean);
  if (unitList.length === 0) return sanitizeValueName(v);
  const endsWithUnit = unitList.some((u) => u.length > 0 && v.endsWith(u));
  if (endsWithUnit) return sanitizeValueName(v);
  const primary = unitList[0];
  return sanitizeValueName(v + primary);
}

function buildStandardPurchaseOptionsForLabel(rawLabel, stdOptions, opts = {}) {
  const productTitle = String(opts.productTitle || opts.productName || '');
  const safeLabel = sanitizeValueName(rawLabel);
  const tokens = mergeOptionAndProductTokens(safeLabel, productTitle);

  return (stdOptions || []).map((spo) => {
    const fallback = pickDefaultValue(spo);
    const rawVal = getValueForOptionName(spo?.optionName, tokens, fallback);
    let valueName = snapValueToGuide(rawVal, spo);
    valueName = enforceOptionUsableUnits(valueName, spo);
    if (!valueName) valueName = snapValueToGuide(fallback, spo);
    return {
      optionId: spo.optionId,
      valueName: valueName || fallback,
    };
  });
}

function standardPurchaseOptionsSignature(stdOptions, optLabel, productTitle) {
  const row = buildStandardPurchaseOptionsForLabel(optLabel, stdOptions, { productTitle });
  return JSON.stringify(row.map((x) => [Number(x.optionId), String(x.valueName || '')]));
}

function axisDisambiguationPriority(optionName) {
  const n = String(optionName || '');
  if (/종류|타입|모델|라인|선택|기획|구성|세트|패키지|에디션|향|색|컬러|사이즈|용도/i.test(n)) return 100;
  if (/수량|개입|입수|매수|캡슐|정|포/i.test(n)) return 40;
  if (/용량|중량|무게/i.test(n)) return 30;
  return 10;
}

function optionValuesFromSpo(spo) {
  return (spo.optionValues || [])
    .map((v) => String(v.valueName || v.minAttributeValue || '').trim())
    .filter(Boolean);
}

function scoreValueForRaw(valueName, rawLabel) {
  const v = String(valueName || '').toLowerCase();
  const r = String(rawLabel || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!v || !r) return 0;
  if (r.includes(v)) return 100;
  if (v.length >= 2 && r.includes(v.slice(0, Math.min(8, v.length)))) return 80;
  const nums = v.match(/\d+/g);
  if (nums && nums.some((n) => r.includes(n))) return 35;
  return 0;
}

/**
 * 동일 판매옵션 튜플 → 네이버 Duplicate.standardPurchaseOptionValue.fulfillment
 * 가이드 optionValues 안에서 옵션명과의 유사도로 서로 다른 값을 배정한다.
 */
function disambiguateStandardPurchaseOptionRows(rows, rawOptionLabels, stdOptions) {
  if (!rows || rows.length < 2 || !stdOptions || !stdOptions.length) return rows;

  const sig = (row) =>
    JSON.stringify(
      (row.standardPurchaseOptions || []).map((x) => [Number(x.optionId), String(x.valueName || '')])
    );

  const groups = new Map();
  rows.forEach((row, idx) => {
    const s = sig(row);
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push(idx);
  });

  for (const idxList of groups.values()) {
    if (idxList.length < 2) continue;

    const axisCandidates = stdOptions
      .map((spo) => ({
        spo,
        pri: axisDisambiguationPriority(spo.optionName),
        vals: optionValuesFromSpo(spo),
      }))
      .filter((x) => x.vals.length >= idxList.length)
      .sort((a, b) => b.pri - a.pri);

    let fixed = false;
    for (const { spo, vals } of axisCandidates) {
      const optionId = spo.optionId;
      const ordered = idxList.slice().sort((a, b) => {
        const la = String(rawOptionLabels[a] || '').length;
        const lb = String(rawOptionLabels[b] || '').length;
        return lb - la;
      });
      const used = new Set();
      let ok = true;
      for (const rowIdx of ordered) {
        const raw = String(rawOptionLabels[rowIdx] || '');
        const row = rows[rowIdx];
        const opts = row.standardPurchaseOptions || [];
        const j = opts.findIndex((x) => Number(x.optionId) === Number(optionId));
        if (j < 0) {
          ok = false;
          break;
        }
        const candidates = vals.filter((v) => !used.has(v));
        if (candidates.length === 0) {
          ok = false;
          break;
        }
        let best = candidates[0];
        let bestScore = -1;
        for (const v of candidates) {
          const sc = scoreValueForRaw(v, raw);
          if (sc > bestScore) {
            bestScore = sc;
            best = v;
          }
        }
        used.add(best);
        const prev = opts[j].valueName;
        opts[j] = { ...opts[j], valueName: best };
        if (String(prev) !== String(best)) {
          console.log(
            `[group-option-workbook] 판매옵션 중복 분리: SKU#${rowIdx} 축"${spo.optionName}" "${prev}" → "${best}"`
          );
        }
      }
      if (ok) {
        fixed = true;
        break;
      }
    }

    if (!fixed) {
      console.warn(
        '[group-option-workbook] 동일 판매옵션 튜플인데, 옵션 개수만큼 구분값이 있는 축이 없어 자동 분리 실패 — 카테고리/가이드 변경 또는 옵션 수 조정 필요'
      );
    }
  }

  return rows;
}

/** 향·색 등 옵션명이 다른데 용량+수량만 있는 가이드면 모든 행이 동일 튜플 → 네이버 연관/중복 검증 실패 */
function guideCollapsesAllOptionsToSameTuple(stdOptions, optionLabels = [], productTitle = '') {
  const labels = (optionLabels || []).map((l) => String(l || '').trim()).filter(Boolean);
  if (labels.length <= 1) return false;
  const sigs = new Set();
  for (const lab of labels) {
    sigs.add(standardPurchaseOptionsSignature(stdOptions, lab, productTitle));
  }
  return sigs.size <= 1;
}

function chooseBestGuide(categoryId, guides, optionLabels = [], productTitle = '') {
  const list = Array.isArray(guides) ? guides : [];
  if (list.length === 0) return null;

  const workbookInfo = getWorkbookCategoryInfo(categoryId);
  const scored = list.map((guide) => ({
    guide,
    score: scoreGuideAgainstWorkbook(guide, workbookInfo, optionLabels, productTitle),
  }));

  const nonCollapse = scored.filter(
    ({ guide }) => !guideCollapsesAllOptionsToSameTuple(
      guide?.standardPurchaseOptions || [],
      optionLabels,
      productTitle
    )
  );
  const pool = nonCollapse.length > 0 ? nonCollapse : scored;

  let best = pool[0].guide;
  let bestScore = pool[0].score;
  for (let i = 1; i < pool.length; i++) {
    if (pool[i].score > bestScore) {
      best = pool[i].guide;
      bestScore = pool[i].score;
    }
  }

  return {
    guide: best,
    score: bestScore,
    workbookInfo,
    allOptionsCollapsedToSameTuple: guideCollapsesAllOptionsToSameTuple(
      best?.standardPurchaseOptions || [],
      optionLabels,
      productTitle
    ),
  };
}

module.exports = {
  buildStandardPurchaseOptionsForLabel,
  chooseBestGuide,
  disambiguateStandardPurchaseOptionRows,
  getWorkbookCategoryInfo,
  guideCollapsesAllOptionsToSameTuple,
  mergeOptionAndProductTokens,
  pickDefaultValue,
  sanitizeValueName,
  snapValueToGuide,
};
