// Sentences shown on the result card and the end-of-game review.

import { compassDirection, distanceKm } from "../geo.js";
import { formatNumber, roundDistance, withArticle } from "../util.js";

const NEXT_DOOR_KM = 3000;

// "Its capital is Ljubljana." / "Its capitals are Pretoria, Bloemfontein and Cape Town."
export function capitalSentence(country) {
  if (!country.capitals.length) return "";
  return country.capitals.length > 1
    ? `Its capitals are ${country.capital}.`
    : `Its capital is ${country.capital}.`;
}

// Map Mode, wrong guess: says what was clicked and how to get from there to
// the country that was asked for.
//   target, picked: places from the atlas;  pickedName: display name of the guess
export function wrongPlaceSentence(target, picked, pickedName) {
  const targetName = target.country.name;
  const clicked = `You clicked ${withArticle(pickedName)}`;
  const km = distanceKm(picked.shape.labelLatLng, target.shape.labelLatLng);
  if (picked.country && target.country.borders.includes(picked.country.code) && km < NEXT_DOOR_KM) {
    return `${clicked}, which borders ${withArticle(targetName)}.`;
  }
  const direction = compassDirection(picked.shape.labelLatLng, target.shape.labelLatLng);
  return `${clicked}. ${withArticle(targetName, true)} is about ${formatNumber(roundDistance(km))} km to the ${direction}.`;
}

// One line for the end-of-game review, in either mode.
export function missedSentence(result, mode) {
  if (!result.picked) return "You skipped this one.";
  const name = withArticle(result.picked.name);
  return mode === "map" ? `You clicked ${name}.` : `You answered ${name}.`;
}
