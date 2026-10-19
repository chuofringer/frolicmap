import type { Translation } from '../en'

export const map: Translation['map'] = {
  // Brand — the name stays in English/Latin script in both locales.
  brandName: 'funradar',
  brandSuffix: '.app',
  // Developer credit — the developer name is a proper noun, kept Latin script.
  developedBy: '开发者',
  developerName: 'vibemapper',

  // MapControls
  resetBearingAriaLabel: '重置方向',
  resetNorthTitle: '重置为正北方向',
  zoomInLabel: '放大',
  zoomOutLabel: '缩小',
  toggle3DAriaLabel: '切换 3D 视图',
  toggle3DTitleSupported: '3D 视图（建筑物）',
  toggle3DTitleUnsupported: '倾斜视图',
  threeDLabel: '3D',

  // BasemapButton (desktop)
  changeBasemapLabel: '切换底图',
  basemapHeading: '底图',

  // IconBar (mobile ⋯ expander — reuses toggle3D* / threeDLabel above)
  mapStyleLabel: '地图样式',
  moreOptionsAriaLabel: '更多选项',

  // NetworkErrorBanner
  networkErrorDismissAriaLabel: '关闭',
  networkErrorHeading: '地图数据加载失败',
  networkErrorCatalogBody: '地图加载成功，但活动列表未能加载，因此没有显示任何点位。这通常是共享网络上的临时限流。',
  networkErrorCatalogHint: '请稍等片刻后重新加载。如果在公司或学校网络下反复出现，可以试试手机热点。',
  networkErrorConfigBody: '后端服务仍在配置中，请稍后几分钟再试。',
  networkErrorReachPrefix: '你的浏览器无法访问',
  networkErrorReachSuffix: '。企业防火墙（如 Zscaler、Netskope 等）经常会拦截这个请求。',
  networkErrorAllowlistPrefix: '请换一个网络试试（手机热点通常有效），或者请 IT 部门将',
  networkErrorAllowlistAnd: '和',
  networkErrorAllowlistSuffix: '加入白名单。',

  // RainyDayBanner (#213)
  rainyBannerAriaLabel: '雨天室内活动提示',
  rainyBannerBlurb: '{{metro}}目前正在下雨。',
  rainyBannerCta: '查看室内地点',
  rainyBannerDismissAriaLabel: '关闭雨天提示',

  basemaps: {
    light: '浅色',
    dark: '深色',
    street: '街道',
    liberty: 'Liberty (3D)',
    satellite: '卫星影像',
  },
  documentTitle: '亲子活动地图 | funradar.app',
}
