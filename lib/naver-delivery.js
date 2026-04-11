const { proxyFetch, NAVER_API_BASE } = require('./naver-auth');

const OUTBOUND_LOCATIONS_URL = `${NAVER_API_BASE}/v1/logistics/outbound-locations`;
const ADDRESS_BOOKS_URL = `${NAVER_API_BASE}/v1/seller/addressbooks-for-page?page=1&size=100`;

function pickArray(data) {
  const candidates = [
    data,
    data?.items,
    data?.contents,
    data?.content,
    data?.data,
    data?.data?.items,
    data?.data?.contents,
    data?.data?.content,
    data?.addressBooks,
    data?.data?.addressBooks,
  ];
  return candidates.find(Array.isArray) || [];
}

function toBoolean(value) {
  return value === true || value === 'Y' || value === 'TRUE' || value === 'true' || value === 1;
}

function normalizeDeliveryCompany(value) {
  const text = String(value || '').trim();
  return /^[A-Z0-9_]+$/.test(text) ? text : 'HANJIN';
}

function normalizeOutboundLocation(item) {
  const id = Number(
    item?.outboundLocationId ??
    item?.outboundShippingPlaceCode ??
    item?.id ??
    item?.placeId ??
    0
  );
  if (!id) return null;

  return {
    id,
    name: String(
      item?.outboundLocationName ??
      item?.outboundShippingPlaceName ??
      item?.name ??
      item?.placeName ??
      `출고지 ${id}`
    ).trim(),
    deliveryCompany: normalizeDeliveryCompany(
      item?.deliveryCompanyCode ??
      item?.deliveryCompany ??
      item?.deliveryCompanyType
    ),
    isDefault: toBoolean(item?.defaultYn) || toBoolean(item?.representativeYn) || toBoolean(item?.mainYn),
    usable: item?.useYn !== 'N' && item?.deleted !== true,
    raw: item,
  };
}

function normalizeAddressBook(item) {
  const id = Number(
    item?.addressBookId ??
    item?.addressBookNo ??
    item?.id ??
    item?.addressId ??
    0
  );
  if (!id) return null;

  const name = String(
    item?.addressBookName ??
    item?.addressName ??
    item?.name ??
    item?.nickName ??
    `주소 ${id}`
  ).trim();
  const typeText = [
    item?.addressType,
    item?.addressBookType,
    item?.usageType,
    item?.useType,
    item?.purposeType,
    item?.deliveryType,
  ].filter(Boolean).join(' ');

  return {
    id,
    name,
    typeText,
    searchText: `${name} ${typeText}`.toLowerCase(),
    isDefault: toBoolean(item?.defaultYn) || toBoolean(item?.mainYn) || toBoolean(item?.representativeYn),
    usable: item?.useYn !== 'N' && item?.deleted !== true,
    raw: item,
  };
}

function scoreOutboundLocation(item) {
  if (!item) return -1;
  let score = 0;
  if (item.usable) score += 100;
  if (item.isDefault) score += 50;
  if (item.name.includes('기본')) score += 20;
  return score;
}

function scoreAddressBook(item, mode) {
  if (!item) return -1;
  let score = 0;
  if (item.usable) score += 100;
  if (item.isDefault) score += 50;

  if (mode === 'shipping') {
    if (/(출고|발송|배송지|shipping|ship)/i.test(item.searchText)) score += 120;
    if (/(반품|교환|return|claim)/i.test(item.searchText)) score -= 40;
  } else {
    if (/(반품|교환|return|claim)/i.test(item.searchText)) score += 120;
  }

  return score;
}

function chooseBest(items, scorer) {
  return [...items].sort((a, b) => scorer(b) - scorer(a))[0] || null;
}

async function fetchJson(url, headers) {
  const res = await proxyFetch(url, {
    headers: {
      ...headers,
      Accept: 'application/json;charset=UTF-8',
    },
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok) {
    const error = data?.message || data?.code || text || `HTTP ${res.status}`;
    throw new Error(error);
  }

  return data;
}

async function resolveDeliveryProfile(headers) {
  try {
    const [outboundRaw, addressesRaw] = await Promise.all([
      fetchJson(OUTBOUND_LOCATIONS_URL, headers),
      fetchJson(ADDRESS_BOOKS_URL, headers),
    ]);

    const outboundLocations = pickArray(outboundRaw)
      .map(normalizeOutboundLocation)
      .filter(Boolean);
    const addressBooks = pickArray(addressesRaw)
      .map(normalizeAddressBook)
      .filter(Boolean);

    const selectedOutbound = chooseBest(outboundLocations, scoreOutboundLocation);
    const selectedShipping = chooseBest(addressBooks, (item) => scoreAddressBook(item, 'shipping'));
    const selectedReturn = chooseBest(addressBooks, (item) => scoreAddressBook(item, 'return')) || selectedShipping;

    const profile = {
      outboundLocationId: selectedOutbound?.id || null,
      outboundLocationName: selectedOutbound?.name || '',
      deliveryCompany: selectedOutbound?.deliveryCompany || 'HANJIN',
      shippingAddressId: selectedShipping?.id || null,
      shippingAddressName: selectedShipping?.name || '',
      returnAddressId: selectedReturn?.id || selectedShipping?.id || null,
      returnAddressName: selectedReturn?.name || selectedShipping?.name || '',
      deliveryBundleGroupUsable: true,
    };

    if (!profile.shippingAddressId || !profile.returnAddressId) {
      return {
        success: false,
        error: '유효한 배송지/반품지 주소를 찾지 못했습니다. 스마트스토어 센터에서 출고지와 반품/교환지를 먼저 등록해 주세요.',
        profile,
        outboundLocations,
        addressBooks,
      };
    }

    return {
      success: true,
      profile,
      outboundLocations,
      addressBooks,
    };
  } catch (e) {
    return {
      success: false,
      error: `배송 프로필 조회 실패: ${e.message}`,
      profile: null,
      outboundLocations: [],
      addressBooks: [],
    };
  }
}

function buildDeliveryInfo(profile = {}) {
  const shippingAddressId = Number(profile.shippingAddressId || 0);
  const returnAddressId = Number(profile.returnAddressId || shippingAddressId || 0);
  if (!shippingAddressId || !returnAddressId) {
    throw new Error('배송지/반품지 주소 ID가 없습니다.');
  }

  const deliveryInfo = {
    deliveryType: 'DELIVERY',
    deliveryAttributeType: 'NORMAL',
    deliveryCompany: normalizeDeliveryCompany(profile.deliveryCompany),
    deliveryBundleGroupUsable: true,
    deliveryFee: {
      deliveryFeeType: 'PAID',
      baseFee: 3000,
      deliveryFeePayType: 'PREPAID',
      deliveryFeeByArea: {
        deliveryAreaType: 'AREA_2',
        area2extraFee: 5000,
        area3extraFee: 5000,
      },
    },
    claimDeliveryInfo: {
      returnDeliveryFee: 3500,
      exchangeDeliveryFee: 6000,
      shippingAddressId,
      returnAddressId,
    },
  };

  const outboundLocationId = Number(profile.outboundLocationId || 0);
  if (outboundLocationId) {
    deliveryInfo.outboundLocationId = outboundLocationId;
  }

  if (profile.deliveryBundleGroupId != null && profile.deliveryBundleGroupId !== '') {
    const groupId = Number(profile.deliveryBundleGroupId);
    if (Number.isFinite(groupId) && groupId > 0) {
      deliveryInfo.deliveryBundleGroupId = groupId;
    }
  }

  return deliveryInfo;
}

function hasDeliveryProfileError(data) {
  return (data?.invalidInputs || []).some((item) => {
    const text = `${item?.name || ''} ${item?.type || ''} ${item?.message || ''}`;
    return /shippingAddressId|returnAddressId|outboundLocationId|deliveryBundleGroup/i.test(text);
  });
}

module.exports = {
  ADDRESS_BOOKS_URL,
  OUTBOUND_LOCATIONS_URL,
  resolveDeliveryProfile,
  buildDeliveryInfo,
  hasDeliveryProfileError,
};
