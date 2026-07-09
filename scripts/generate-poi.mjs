// generate-poi.mjs — curated Hospitality/Tourism and Public Amenity points for
// the Diriyah dashboard's POI layers.
//
// These are hand-authored from well-known, publicly published facts about the
// Diriyah Gate development (its own visitor-facing materials, general press
// coverage of Bujairi Terrace, and OSM's tourism/amenity tagging scheme) —
// NOT scraped from any private system. Exact building-level coordinates for
// Bujairi Terrace's dining row are not independently surveyed here, so every
// feature carries `"data_quality": "approximate"` and is offset a plausible
// distance from the precisely-anchored landmark points in landmarks.geojson.
// Swap this file for a live Overpass POI export (tourism=*, amenity=*) around
// the same bounding box for production-grade precision — see README.
//
// Run: node scripts/generate-poi.mjs (after convert-map-data.mjs)

import fs from 'fs';
import path from 'path';

const root = process.cwd();
const landmarks = JSON.parse(fs.readFileSync(path.join(root, 'data/diriyah/landmarks.geojson'), 'utf8'));
const byId = Object.fromEntries(landmarks.features.map((f) => [f.properties.id, f.geometry.coordinates]));

const meta = JSON.parse(fs.readFileSync(path.join(root, 'src/diriyah/map-data.json'), 'utf8')).meta;
const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = 111_320 * Math.cos(meta.lat0 * DEG);

// offset a [lon,lat] anchor by (eastMetres, northMetres)
function offset([lon, lat], east, north) {
  return [round(lon + east / M_PER_DEG_LON, 7), round(lat + north / M_PER_DEG_LAT, 7)];
}
function round(n, d) {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

const visitor = byId.visitor;
const turaif = byId.turaif;

function feature(coords, props) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: coords },
    properties: { data_quality: 'approximate', ...props },
  };
}

const hospitality = [
  feature(offset(visitor, 420, 260), {
    id: 'poi-bujairi-terrace',
    category: 'hospitality',
    subcategory: 'dining_district',
    name_en: 'Bujairi Terrace',
    name_ar: 'شرفة البجيري',
    tag: 'Dining & lifestyle terrace overlooking At-Turaif',
  }),
  feature(offset(visitor, 460, 300), {
    id: 'poi-bujairi-cafe-row',
    category: 'hospitality',
    subcategory: 'cafe',
    name_en: 'Bujairi Terrace – Café Row',
    name_ar: 'صف المقاهي – شرفة البجيري',
    tag: 'Cafés with views across Wadi Hanifah to At-Turaif',
  }),
  feature(offset(visitor, 380, 220), {
    id: 'poi-bujairi-restaurants',
    category: 'hospitality',
    subcategory: 'restaurant',
    name_en: 'Bujairi Terrace – Restaurant Row',
    name_ar: 'صف المطاعم – شرفة البجيري',
    tag: 'International & Saudi dining overlooking the escarpment',
  }),
  feature(offset(visitor, 150, 60), {
    id: 'poi-visitor-centre',
    category: 'hospitality',
    subcategory: 'visitor_centre',
    name_en: 'Diriyah Visitor Centre',
    name_ar: 'مركز زوار الدرعية',
    tag: 'Gateway, tickets & orientation for At-Turaif',
  }),
  feature(offset(turaif, -60, 90), {
    id: 'poi-turaif-walking-museum',
    category: 'hospitality',
    subcategory: 'museum',
    name_en: 'At-Turaif Walking Museums',
    name_ar: 'متاحف الطريف',
    tag: 'Guided walking-museum route through the historic quarter',
  }),
  feature(offset(visitor, 520, 340), {
    id: 'poi-wadi-viewpoint',
    category: 'hospitality',
    subcategory: 'viewpoint',
    name_en: 'Wadi Hanifah Viewpoint',
    name_ar: 'إطلالة وادي حنيفة',
    tag: 'Panoramic viewpoint over the wadi and palm groves',
  }),
];

const amenities = [
  feature(offset(visitor, 60, -40), {
    id: 'poi-parking-main',
    category: 'amenity',
    subcategory: 'parking',
    name_en: 'Diriyah Gate Visitor Parking',
    name_ar: 'مواقف زوار بوابة الدرعية',
    tag: 'Main public parking for At-Turaif visitors',
  }),
  feature(offset(visitor, 200, 20), {
    id: 'poi-info-kiosk',
    category: 'amenity',
    subcategory: 'information',
    name_en: 'Information Kiosk',
    name_ar: 'كشك معلومات',
    tag: 'Maps, tickets & guide info',
  }),
  feature(offset(visitor, 170, -10), {
    id: 'poi-restrooms-visitor',
    category: 'amenity',
    subcategory: 'restroom',
    name_en: 'Public Restrooms',
    name_ar: 'دورات مياه عامة',
    tag: 'Visitor-centre facilities',
  }),
  feature(offset(turaif, 40, -60), {
    id: 'poi-musalla-turaif',
    category: 'amenity',
    subcategory: 'prayer_room',
    name_en: 'Musalla (Prayer Room)',
    name_ar: 'مصلى',
    tag: 'Prayer facilities near the historic mosque',
  }),
  feature(offset(visitor, 90, 140), {
    id: 'poi-bike-share',
    category: 'amenity',
    subcategory: 'bicycle_rental',
    name_en: 'Wadi Hanifah Bike Path Station',
    name_ar: 'محطة دراجات - مسار وادي حنيفة',
    tag: 'Shared-bike access to the Wadi Hanifah trail network',
  }),
  feature(offset(visitor, 250, 80), {
    id: 'poi-first-aid',
    category: 'amenity',
    subcategory: 'first_aid',
    name_en: 'First Aid Point',
    name_ar: 'نقطة إسعافات أولية',
    tag: 'Medical first-response point',
  }),
  feature(offset(visitor, 30, 200), {
    id: 'poi-atm',
    category: 'amenity',
    subcategory: 'atm',
    name_en: 'ATM',
    name_ar: 'صراف آلي',
    tag: 'Cash point',
  }),
  feature(offset(turaif, 120, 40), {
    id: 'poi-souq',
    category: 'amenity',
    subcategory: 'marketplace',
    name_en: 'Heritage Souq Stalls',
    name_ar: 'أكشاك السوق التراثي',
    tag: 'Traditional-craft & date market stalls',
  }),
];

const out = { type: 'FeatureCollection', features: [...hospitality, ...amenities] };
fs.writeFileSync(path.join(root, 'data/diriyah/poi.geojson'), JSON.stringify(out));
console.log(`wrote data/diriyah/poi.geojson (${out.features.length} features)`);
