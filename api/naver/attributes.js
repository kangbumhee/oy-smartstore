const { getAccessToken, getAuthHeadersFromToken, resolveCredentials, resolveToken, proxyFetch, NAVER_API_BASE } = require('../../lib/naver-auth');

async function resolveHeaders(req) {
  let token = resolveToken(req);
  if (!token) {
    const { clientId, clientSecret } = resolveCredentials(req);
    const result = await getAccessToken(clientId, clientSecret);
    token = result.token;
  }
  return getAuthHeadersFromToken(token);
}

const ATTR_META_URL = `${NAVER_API_BASE}/v1/product-attributes/attributes`;
const ATTR_VALUES_URL = `${NAVER_API_BASE}/v1/product-attributes/attribute-values`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Naver-Client-Id, X-Naver-Client-Secret, X-Naver-Token');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { categoryId } = req.query || {};
  if (!categoryId) return res.status(400).json({ error: 'categoryId required' });

  try {
    const headers = await resolveHeaders(req);
    delete headers['Content-Type'];
    headers['Accept'] = 'application/json;charset=UTF-8';

    const [metaRes, valuesRes] = await Promise.all([
      proxyFetch(`${ATTR_META_URL}?categoryId=${categoryId}`, { headers }),
      proxyFetch(`${ATTR_VALUES_URL}?categoryId=${categoryId}`, { headers }),
    ]);

    let attrMeta = [];
    if (metaRes.ok) {
      try { attrMeta = await metaRes.json(); } catch { /* ignore */ }
    } else {
      console.log('[attributes] meta fetch failed:', metaRes.status);
    }

    let attrValues = [];
    if (valuesRes.ok) {
      try { attrValues = await valuesRes.json(); } catch { /* ignore */ }
    }

    if (!Array.isArray(attrMeta)) attrMeta = [];
    if (!Array.isArray(attrValues)) attrValues = [];

    const valuesBySeq = {};
    for (const v of attrValues) {
      const seq = v.attributeSeq;
      if (!valuesBySeq[seq]) valuesBySeq[seq] = [];
      valuesBySeq[seq].push({
        valueSeq: v.attributeValueSeq,
        value: v.minAttributeValue || '',
        order: v.exposureOrder || 0,
      });
    }

    const attributes = attrMeta.map(m => ({
      attributeSeq: m.attributeSeq,
      name: m.attributeName || `속성${m.attributeSeq}`,
      required: m.attributeType === 'PRIMARY',
      type: m.attributeClassificationType || 'SINGLE_SELECT',
      attributeType: m.attributeType,
      unitUsable: m.unitUsable || false,
      unitCode: m.representativeUnitCode || null,
      maxSelect: m.attributeValueMaxMatchingCount || 1,
      values: (valuesBySeq[m.attributeSeq] || []).sort((a, b) => a.order - b.order),
    }));

    const requiredAttrs = attributes.filter(a => a.required);
    const optionalAttrs = attributes.filter(a => !a.required);

    return res.status(200).json({
      success: true,
      totalMeta: attrMeta.length,
      totalValues: attrValues.length,
      attributes,
      requiredCount: requiredAttrs.length,
      optionalCount: optionalAttrs.length,
    });
  } catch (e) {
    console.error('[attributes] error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};
