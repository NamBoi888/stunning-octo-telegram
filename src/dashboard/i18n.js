// i18n.js — static bilingual UI strings (English / Arabic) and RTL toggling.
// Only interface chrome lives here; landmark narrative content stays in
// culture-content.js so both the game and the dashboard read from one place.

export const STRINGS = {
  en: {
    dir: 'ltr',
    appTitle: 'Diriyah Explorer',
    appSubtitle: 'Geospatial Dashboard · At-Turaif & Bujairi',
    searchPlaceholder: 'Search landmarks, POIs…',
    layers: 'Layers',
    legend: 'Legend',
    basemap: 'Basemap',
    basemapLight: 'Light',
    basemapDark: 'Dark',
    basemapSatellite: 'Satellite',
    tools: 'Tools',
    toolMeasureDistance: 'Measure distance',
    toolMeasureArea: 'Measure area',
    toolRadius: 'Radius filter',
    toolCompare: 'Compare layers',
    toolStory: 'Guided tour',
    toolShare: 'Share view',
    toolScreenshot: 'Screenshot',
    toolClear: 'Clear',
    analytics: 'Analytics',
    analyticsPoiDensity: 'POI density heatmap',
    analyticsWalkability: 'Walkability (path density)',
    analyticsLandUse: 'Land-use distribution',
    analyticsGreenRatio: 'Green vs built-up ratio',
    analyticsBuffers: 'Accessibility buffers (400 m walk)',
    layerHeritage: 'Heritage & Culture',
    layerEnvironment: 'Environment & Wadi',
    layerUrban: 'Urban Fabric',
    layerTransport: 'Transportation & Mobility',
    layerHospitality: 'Hospitality & Tourism',
    layerAmenity: 'Public Amenities',
    layerBoundary: 'Study Area Boundary',
    close: 'Close',
    category: 'Category',
    height: 'Height',
    width: 'Width',
    dataQualityApprox: 'Approximate location — demo dataset',
    sourceOsm: 'Source: OpenStreetMap contributors (ODbL)',
    noResults: 'No matches',
    storyPlay: 'Start tour',
    storyNext: 'Next',
    storyPrev: 'Back',
    storyExit: 'Exit tour',
    storyStep: 'Stop',
    measureDistanceHint: 'Click to add points, double-click to finish.',
    measureAreaHint: 'Click to add polygon points, double-click to finish.',
    radiusHint: 'Click the map to place a radius filter.',
    radiusLabel: 'Radius (m)',
    compareLeft: 'Left',
    compareRight: 'Right',
    shareCopied: 'Shareable link copied to clipboard',
    screenshotSaved: 'Screenshot downloaded',
    langToggle: 'العربية',
    themeToggle: 'Dark mode',
  },
  ar: {
    dir: 'rtl',
    appTitle: 'مستكشف الدرعية',
    appSubtitle: 'لوحة معلومات جغرافية · الطريف والبجيري',
    searchPlaceholder: 'ابحث عن معالم أو مواقع…',
    layers: 'الطبقات',
    legend: 'مفتاح الخريطة',
    basemap: 'الخريطة الأساسية',
    basemapLight: 'فاتحة',
    basemapDark: 'داكنة',
    basemapSatellite: 'قمر صناعي',
    tools: 'الأدوات',
    toolMeasureDistance: 'قياس المسافة',
    toolMeasureArea: 'قياس المساحة',
    toolRadius: 'تصفية بنطاق دائري',
    toolCompare: 'مقارنة الطبقات',
    toolStory: 'جولة إرشادية',
    toolShare: 'مشاركة العرض',
    toolScreenshot: 'لقطة شاشة',
    toolClear: 'مسح',
    analytics: 'التحليلات',
    analyticsPoiDensity: 'خريطة كثافة المواقع',
    analyticsWalkability: 'إمكانية المشي (كثافة المسارات)',
    analyticsLandUse: 'توزيع استخدام الأراضي',
    analyticsGreenRatio: 'نسبة المساحات الخضراء إلى المبنية',
    analyticsBuffers: 'نطاقات الوصول (٤٠٠ م سيرًا)',
    layerHeritage: 'التراث والثقافة',
    layerEnvironment: 'البيئة والوادي',
    layerUrban: 'النسيج العمراني',
    layerTransport: 'النقل والتنقل',
    layerHospitality: 'الضيافة والسياحة',
    layerAmenity: 'المرافق العامة',
    layerBoundary: 'حدود منطقة الدراسة',
    close: 'إغلاق',
    category: 'الفئة',
    height: 'الارتفاع',
    width: 'العرض',
    dataQualityApprox: 'موقع تقريبي — بيانات توضيحية',
    sourceOsm: 'المصدر: مساهمو OpenStreetMap (رخصة ODbL)',
    noResults: 'لا توجد نتائج',
    storyPlay: 'ابدأ الجولة',
    storyNext: 'التالي',
    storyPrev: 'السابق',
    storyExit: 'إنهاء الجولة',
    storyStep: 'محطة',
    measureDistanceHint: 'انقر لإضافة نقاط، وانقر نقرًا مزدوجًا للإنهاء.',
    measureAreaHint: 'انقر لإضافة نقاط المضلع، وانقر نقرًا مزدوجًا للإنهاء.',
    radiusHint: 'انقر على الخريطة لتحديد نطاق التصفية.',
    radiusLabel: 'النطاق (م)',
    compareLeft: 'يسار',
    compareRight: 'يمين',
    shareCopied: 'تم نسخ رابط المشاركة',
    screenshotSaved: 'تم تنزيل لقطة الشاشة',
    langToggle: 'English',
    themeToggle: 'الوضع الداكن',
  },
};

let current = 'en';
const listeners = new Set();

export function t(key) {
  return STRINGS[current][key] ?? STRINGS.en[key] ?? key;
}

export function getLang() {
  return current;
}

export function setLang(lang) {
  if (lang !== 'en' && lang !== 'ar') return;
  current = lang;
  document.documentElement.lang = lang;
  document.documentElement.dir = STRINGS[lang].dir;
  for (const fn of listeners) fn(lang);
}

export function onLangChange(fn) {
  listeners.add(fn);
}
