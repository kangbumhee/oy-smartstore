const COMMON_RETURN = '전자상거래등에서의소비자보호에관한법률 등에 의한 제품의 하자 또는 오배송 등으로 인한 청약철회의 경우에는 상품 수령 후 3개월 이내, 그 사실을 안 날 또는 알 수 있었던 날로부터 30일 이내에 청약철회를 할 수 있으며, 반품 배송비는 판매자가 부담합니다.';
const COMMON_NO_REFUND = '소비자의 책임 있는 사유로 상품 등이 멸실되거나 훼손된 경우, 소비자의 사용, 포장 개봉에 의해 상품 등의 가치가 현저히 감소한 경우 청약철회가 제한될 수 있습니다.';
const COMMON_QUALITY = '소비자분쟁해결기준(공정거래위원회 고시)에 따라 피해를 보상받을 수 있습니다.';
const COMMON_COMPENSATION = '주문취소 및 반품 시 환불은 주문취소 및 반품 완료 후 영업일 기준 2~3일 이내 처리됩니다.';
const COMMON_TROUBLE = '소비자 분쟁해결 기준(공정거래위원회 고시)에 의거 처리합니다.';
const COMMON_WARRANTY = '소비자분쟁해결기준(공정거래위원회 고시)에 따름';
const SELLER_PHONE = '010-7253-0101';
const SEE_DETAIL = '상세페이지 참조';

const AFTER_SERVICE_INFO = {
  afterServiceTelephoneNumber: SELLER_PHONE,
  afterServiceGuideContent: '제품 특성상 개봉 후에는 교환,환불이 불가하오니 비닐을 제거하기 전 파손이나 심각한 문제가 있는 경우 바로 네이버 톡톡으로 문의 주셔야 교환 접수가 가능합니다.',
};

const ORIGIN_AREA_INFO = {
  originAreaCode: '03',
  content: '상세설명에 표시',
  importer: SEE_DETAIL,
};

const CERTIFICATION_EXCLUDE = {
  childCertifiedProductExclusionYn: true,
  kcCertifiedProductExclusionYn: 'TRUE',
  greenCertifiedProductExclusionYn: true,
};

const DELIVERY_INFO = {
  deliveryType: 'DELIVERY',
  deliveryAttributeType: 'NORMAL',
  deliveryCompany: 'HANJIN',
  outboundShippingPlaceCode: 100797935,
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
    shippingAddressId: 100797935,
    returnAddressId: 100797936,
  },
};

const commonFields = {
  returnCostReason: COMMON_RETURN,
  noRefundReason: COMMON_NO_REFUND,
  qualityAssuranceStandard: COMMON_QUALITY,
  compensationProcedure: COMMON_COMPENSATION,
  troubleShootingContents: COMMON_TROUBLE,
};

function cosmeticNotice(brand) {
  return {
    productInfoProvidedNoticeType: 'COSMETIC',
    cosmetic: {
      ...commonFields,
      capacity: SEE_DETAIL,
      specification: SEE_DETAIL,
      expirationDateText: '제조일로부터 36개월',
      usage: SEE_DETAIL,
      manufacturer: brand || SEE_DETAIL,
      producer: SEE_DETAIL,
      distributor: SEE_DETAIL,
      customizedDistributor: '',
      mainIngredient: SEE_DETAIL,
      certificationType: SEE_DETAIL,
      caution: SEE_DETAIL,
      warrantyPolicy: COMMON_WARRANTY,
      customerServicePhoneNumber: SELLER_PHONE,
    },
  };
}

function dietFoodNotice(brand) {
  return {
    productInfoProvidedNoticeType: 'DIET_FOOD',
    dietFood: {
      ...commonFields,
      productName: SEE_DETAIL,
      producer: brand || SEE_DETAIL,
      location: SEE_DETAIL,
      expirationDateText: SEE_DETAIL,
      consumptionDate: '2028-12-31',
      storageMethod: SEE_DETAIL,
      weight: SEE_DETAIL,
      amount: SEE_DETAIL,
      ingredients: SEE_DETAIL,
      nutritionFacts: SEE_DETAIL,
      specification: SEE_DETAIL,
      cautionAndSideEffect: SEE_DETAIL,
      nonMedicinalUsesMessage: '이 제품은 질병의 예방 및 치료를 위한 의약품이 아닙니다.',
      geneticallyModified: false,
      importDeclarationCheck: false,
      consumerSafetyCaution: SEE_DETAIL,
      customerServicePhoneNumber: SELLER_PHONE,
    },
  };
}

function generalFoodNotice(brand) {
  return {
    productInfoProvidedNoticeType: 'GENERAL_FOOD',
    generalFood: {
      ...commonFields,
      productName: SEE_DETAIL,
      foodType: SEE_DETAIL,
      producer: brand || SEE_DETAIL,
      location: SEE_DETAIL,
      packDateText: SEE_DETAIL,
      expirationDateText: SEE_DETAIL,
      weight: SEE_DETAIL,
      amount: SEE_DETAIL,
      ingredients: SEE_DETAIL,
      nutritionFacts: SEE_DETAIL,
      geneticallyModified: false,
      consumerSafetyCaution: SEE_DETAIL,
      importDeclarationCheck: false,
      customerServicePhoneNumber: SELLER_PHONE,
    },
  };
}

function biochemistryNotice(brand) {
  return {
    productInfoProvidedNoticeType: 'BIOCHEMISTRY',
    biochemistry: {
      ...commonFields,
      productName: SEE_DETAIL,
      dosageForm: SEE_DETAIL,
      packDateText: SEE_DETAIL,
      expirationDateText: SEE_DETAIL,
      weight: SEE_DETAIL,
      effect: SEE_DETAIL,
      importer: SEE_DETAIL,
      producer: brand || SEE_DETAIL,
      manufacturer: SEE_DETAIL,
      childProtection: SEE_DETAIL,
      chemicals: SEE_DETAIL,
      caution: SEE_DETAIL,
      safeCriterionNo: SEE_DETAIL,
      customerServicePhoneNumber: SELLER_PHONE,
    },
  };
}

function homeAppliancesNotice(brand) {
  return {
    productInfoProvidedNoticeType: 'HOME_APPLIANCES',
    homeAppliances: {
      ...commonFields,
      itemName: SEE_DETAIL,
      modelName: SEE_DETAIL,
      certificationType: SEE_DETAIL,
      ratedVoltage: SEE_DETAIL,
      powerConsumption: SEE_DETAIL,
      energyEfficiencyRating: '해당없음',
      releaseDateText: SEE_DETAIL,
      manufacturer: brand || SEE_DETAIL,
      size: SEE_DETAIL,
      additionalCost: '없음',
      warrantyPolicy: COMMON_WARRANTY,
      afterServiceDirector: SELLER_PHONE,
    },
  };
}

function kitchenUtensilsNotice(brand) {
  return {
    productInfoProvidedNoticeType: 'KITCHEN_UTENSILS',
    kitchenUtensils: {
      ...commonFields,
      itemName: SEE_DETAIL,
      modelName: SEE_DETAIL,
      material: SEE_DETAIL,
      component: SEE_DETAIL,
      size: SEE_DETAIL,
      releaseDateText: SEE_DETAIL,
      manufacturer: brand || SEE_DETAIL,
      producer: SEE_DETAIL,
      importDeclaration: false,
      warrantyPolicy: COMMON_WARRANTY,
      afterServiceDirector: SELLER_PHONE,
    },
  };
}

function etcNotice(brand) {
  return {
    productInfoProvidedNoticeType: 'ETC',
    etc: {
      ...commonFields,
      itemName: SEE_DETAIL,
      modelName: SEE_DETAIL,
      certificateDetails: SEE_DETAIL,
      manufacturer: brand || SEE_DETAIL,
      customerServicePhoneNumber: SELLER_PHONE,
    },
  };
}

const CATEGORY_TO_NOTICE_MAP = {
  '스킨케어': 'COSMETIC', '스킨': 'COSMETIC', '로션': 'COSMETIC', '에센스': 'COSMETIC',
  '세럼': 'COSMETIC', '크림': 'COSMETIC', '토너': 'COSMETIC', '미스트': 'COSMETIC',
  '오일': 'COSMETIC', '앰플': 'COSMETIC', '메이크업': 'COSMETIC', '베이스메이크업': 'COSMETIC',
  '립메이크업': 'COSMETIC', '아이메이크업': 'COSMETIC', '파운데이션': 'COSMETIC',
  '립스틱': 'COSMETIC', '마스카라': 'COSMETIC', '쿠션': 'COSMETIC', '프라이머': 'COSMETIC',
  '컨실러': 'COSMETIC', '블러셔': 'COSMETIC', '아이섀도': 'COSMETIC', '아이라이너': 'COSMETIC',
  '아이브로우': 'COSMETIC', '클렌징': 'COSMETIC', '클렌저': 'COSMETIC', '클렌징오일': 'COSMETIC',
  '클렌징폼': 'COSMETIC', '클렌징워터': 'COSMETIC', '필링': 'COSMETIC', '선케어': 'COSMETIC',
  '선크림': 'COSMETIC', '선스틱': 'COSMETIC', '자외선차단': 'COSMETIC', '마스크': 'COSMETIC',
  '마스크팩': 'COSMETIC', '팩': 'COSMETIC', '패드': 'COSMETIC', '네일': 'COSMETIC',
  '네일컬러': 'COSMETIC', '매니큐어': 'COSMETIC', '향수': 'COSMETIC', '퍼퓸': 'COSMETIC',
  '디퓨저': 'COSMETIC', '바디로션': 'COSMETIC', '바디워시': 'COSMETIC', '바디케어': 'COSMETIC',
  '바디': 'COSMETIC', '핸드크림': 'COSMETIC', '풋케어': 'COSMETIC', '데오드란트': 'COSMETIC',
  '헤어케어': 'COSMETIC', '샴푸': 'COSMETIC', '린스': 'COSMETIC', '컨디셔너': 'COSMETIC',
  '트리트먼트': 'COSMETIC', '헤어에센스': 'COSMETIC', '헤어오일': 'COSMETIC',
  '스타일링': 'COSMETIC', '염색': 'COSMETIC', '두피케어': 'COSMETIC',
  '남성화장품': 'COSMETIC', '쉐이빙': 'COSMETIC', '더모코스메틱': 'COSMETIC',
  '시카': 'COSMETIC', '레티놀': 'COSMETIC',
  '건강식품': 'DIET_FOOD', '이너뷰티': 'DIET_FOOD', '다이어트': 'DIET_FOOD',
  '유산균': 'DIET_FOOD', '프로바이오틱스': 'DIET_FOOD', '비타민': 'DIET_FOOD',
  '콜라겐': 'DIET_FOOD', '오메가3': 'DIET_FOOD', '루테인': 'DIET_FOOD',
  '영양제': 'DIET_FOOD', '홍삼': 'DIET_FOOD', '프로틴': 'DIET_FOOD',
  '단백질': 'DIET_FOOD', '생식': 'DIET_FOOD', '라이프밀': 'DIET_FOOD',
  '식품': 'GENERAL_FOOD', '간식': 'GENERAL_FOOD', '음료': 'GENERAL_FOOD',
  '차': 'GENERAL_FOOD', '커피': 'GENERAL_FOOD', '시리얼': 'GENERAL_FOOD',
  '견과류': 'GENERAL_FOOD', '밀키트': 'GENERAL_FOOD',
  '세제': 'BIOCHEMISTRY', '섬유유연제': 'BIOCHEMISTRY', '방향제': 'BIOCHEMISTRY',
  '탈취제': 'BIOCHEMISTRY', '살균': 'BIOCHEMISTRY', '세정': 'BIOCHEMISTRY',
  '뷰티디바이스': 'HOME_APPLIANCES', '뷰티기기': 'HOME_APPLIANCES',
  'LED마스크': 'HOME_APPLIANCES', '피부관리기': 'HOME_APPLIANCES',
  '고데기': 'HOME_APPLIANCES', '드라이기': 'HOME_APPLIANCES', '헤어기기': 'HOME_APPLIANCES',
  '생활용품': 'KITCHEN_UTENSILS', '욕실용품': 'KITCHEN_UTENSILS',
  '구강용품': 'KITCHEN_UTENSILS', '치약': 'KITCHEN_UTENSILS', '칫솔': 'KITCHEN_UTENSILS',
  '면도기': 'KITCHEN_UTENSILS', '위생용품': 'KITCHEN_UTENSILS',
  '여성위생': 'KITCHEN_UTENSILS', '생리대': 'KITCHEN_UTENSILS',
  '탐폰': 'KITCHEN_UTENSILS', '물티슈': 'KITCHEN_UTENSILS',
  '화장솜': 'KITCHEN_UTENSILS', '면봉': 'KITCHEN_UTENSILS',
  '휴족시간': 'ETC', '파스': 'ETC', '쿨링': 'ETC', '냉각': 'ETC',
  '핫패드': 'ETC', '찜질': 'ETC', '밴드': 'ETC', '반창고': 'ETC', '의약외품': 'ETC',
};

const PRODUCT_NAME_OVERRIDES = {
  '휴족시간': 'ETC', '파스': 'ETC', '쿨링패드': 'ETC', '냉각시트': 'ETC',
  '핫패드': 'ETC', '찜질': 'ETC', '밴드': 'ETC', '반창고': 'ETC',
  '의약외품': 'ETC', '안대': 'ETC', '체온계': 'ETC',
  '생식': 'DIET_FOOD', '라이프밀': 'DIET_FOOD', '프로틴바': 'DIET_FOOD',
  '단백질바': 'DIET_FOOD', '에너지바': 'DIET_FOOD', '건강즙': 'DIET_FOOD',
  '세탁': 'BIOCHEMISTRY', '표백': 'BIOCHEMISTRY', '소독': 'BIOCHEMISTRY',
  '충전기': 'HOME_APPLIANCES', '가습기': 'HOME_APPLIANCES',
  '칫솔': 'KITCHEN_UTENSILS', '치약': 'KITCHEN_UTENSILS',
  '면도기': 'KITCHEN_UTENSILS', '생리대': 'KITCHEN_UTENSILS',
};

const NOTICE_BUILDERS = {
  COSMETIC: cosmeticNotice,
  DIET_FOOD: dietFoodNotice,
  GENERAL_FOOD: generalFoodNotice,
  BIOCHEMISTRY: biochemistryNotice,
  HOME_APPLIANCES: homeAppliancesNotice,
  KITCHEN_UTENSILS: kitchenUtensilsNotice,
  ETC: etcNotice,
};

function getProductNotice(oyCategory, productName, brand) {
  oyCategory = oyCategory || '';
  productName = productName || '';
  brand = brand || '';
  const productLower = productName.toLowerCase();

  for (const [kw, noticeType] of Object.entries(PRODUCT_NAME_OVERRIDES)) {
    if (productLower.includes(kw)) {
      return NOTICE_BUILDERS[noticeType](brand);
    }
  }

  if (CATEGORY_TO_NOTICE_MAP[oyCategory]) {
    return NOTICE_BUILDERS[CATEGORY_TO_NOTICE_MAP[oyCategory]](brand);
  }

  for (const [kw, noticeType] of Object.entries(CATEGORY_TO_NOTICE_MAP)) {
    if (oyCategory.includes(kw)) {
      return NOTICE_BUILDERS[noticeType](brand);
    }
  }

  const searchText = `${oyCategory} ${productName}`.toLowerCase();
  const priorityOrder = ['DIET_FOOD', 'GENERAL_FOOD', 'BIOCHEMISTRY', 'HOME_APPLIANCES', 'KITCHEN_UTENSILS', 'COSMETIC'];
  for (const targetType of priorityOrder) {
    const kwsForType = Object.entries(CATEGORY_TO_NOTICE_MAP)
      .filter(([, v]) => v === targetType)
      .map(([k]) => k);
    for (const kw of kwsForType) {
      if (searchText.includes(kw.toLowerCase())) {
        return NOTICE_BUILDERS[targetType](brand);
      }
    }
  }

  return NOTICE_BUILDERS.COSMETIC(brand);
}

function getDetailAttribute(oyCategory, productName, brand) {
  return {
    afterServiceInfo: AFTER_SERVICE_INFO,
    originAreaInfo: ORIGIN_AREA_INFO,
    productInfoProvidedNotice: getProductNotice(oyCategory, productName, brand),
    certificationTargetExcludeContent: CERTIFICATION_EXCLUDE,
    minorPurchasable: true,
  };
}

module.exports = {
  DELIVERY_INFO,
  AFTER_SERVICE_INFO,
  ORIGIN_AREA_INFO,
  CERTIFICATION_EXCLUDE,
  getProductNotice,
  getDetailAttribute,
};
