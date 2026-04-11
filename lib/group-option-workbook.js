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
  if (name.includes('용량')) return '1개';
  return '1개';
}

function getWorkbookCategoryInfo(categoryId) {
  return workbookData[String(categoryId || '').trim()] || null;
}

function extractTokens(rawLabel) {
  const label = String(rawLabel || '').trim();
  const measure = (label.match(/\d+(?:\.\d+)?\s?(?:ml|mL|l|L|g|kg|mg|oz)\b/) || [])[0] || '';
  const size = (label.match(/\d+(?:\.\d+)?\s?(?:호|cm|mm|inch|인치)\b/) || [])[0] || '';
  const count = (label.match(/\d+\s?(?:개|입|종|매|캡슐|정|ea|EA)\b/) || [])[0] || '';
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

  if (/색상/.test(name)) return tokens.generic || fallback;
  if (/(용량|중량|무게)/.test(name)) return tokens.measure || fallback;
  if (/(수량|종류 수량|개당 수량)/.test(name)) return tokens.count || fallback;
  if (/(사이즈|크기|그립사이즈)/.test(name)) return tokens.size || fallback;
  if (/구성/.test(name)) return tokens.composition || tokens.bracket || '';
  if (/종류/.test(name)) return tokens.composition || '';
  return tokens.generic || fallback;
}

function scoreGuideAgainstWorkbook(guide, workbookInfo, optionLabels) {
  const names = (guide?.standardPurchaseOptions || []).map((item) => item?.optionName).filter(Boolean);
  const normalizedNames = names.map(normalizeLabel);
  let score = 0;

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
      const value = getValueForOptionName(optionName, extractTokens(label), '');
      return Boolean(value);
    }).length;
    score += matchedCount > 0 ? 40 : -20;
  }

  return score;
}

function chooseBestGuide(categoryId, guides, optionLabels = []) {
  const list = Array.isArray(guides) ? guides : [];
  if (list.length === 0) return null;

  const workbookInfo = getWorkbookCategoryInfo(categoryId);
  let best = list[0];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const guide of list) {
    const score = scoreGuideAgainstWorkbook(guide, workbookInfo, optionLabels);
    if (score > bestScore) {
      best = guide;
      bestScore = score;
    }
  }

  return {
    guide: best,
    score: bestScore,
    workbookInfo,
  };
}

function buildStandardPurchaseOptionsForLabel(rawLabel, stdOptions) {
  const safeLabel = sanitizeValueName(rawLabel);
  const tokens = extractTokens(safeLabel);

  return (stdOptions || []).map((spo) => {
    const fallback = pickDefaultValue(spo);
    const valueName = sanitizeValueName(getValueForOptionName(spo?.optionName, tokens, fallback));
    return {
      optionId: spo.optionId,
      valueName: valueName || fallback,
    };
  });
}

module.exports = {
  buildStandardPurchaseOptionsForLabel,
  chooseBestGuide,
  getWorkbookCategoryInfo,
  pickDefaultValue,
  sanitizeValueName,
};
