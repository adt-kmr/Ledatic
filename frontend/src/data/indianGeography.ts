import type { IndianState, IndianCity, TelecomCircle } from "../types/btic";

export const INDIAN_STATES: IndianState[] = [
  { name: "Maharashtra", code: "MH", center: [19.75, 75.71], threatWeight: 1.4 },
  { name: "Delhi NCR", code: "DL", center: [28.61, 77.23], threatWeight: 1.6 },
  { name: "Karnataka", code: "KA", center: [15.32, 75.71], threatWeight: 1.2 },
  { name: "Tamil Nadu", code: "TN", center: [11.13, 78.06], threatWeight: 1.1 },
  { name: "Uttar Pradesh", code: "UP", center: [26.85, 80.91], threatWeight: 1.5 },
  { name: "Gujarat", code: "GJ", center: [22.26, 71.19], threatWeight: 1.3 },
  { name: "Rajasthan", code: "RJ", center: [27.02, 74.22], threatWeight: 1.0 },
  { name: "West Bengal", code: "WB", center: [22.99, 87.75], threatWeight: 1.2 },
  { name: "Madhya Pradesh", code: "MP", center: [22.97, 78.66], threatWeight: 0.9 },
  { name: "Telangana", code: "TS", center: [17.12, 79.20], threatWeight: 1.3 },
  { name: "Andhra Pradesh", code: "AP", center: [15.91, 79.74], threatWeight: 1.0 },
  { name: "Kerala", code: "KL", center: [10.85, 76.27], threatWeight: 0.8 },
  { name: "Punjab", code: "PB", center: [31.15, 75.34], threatWeight: 1.1 },
  { name: "Haryana", code: "HR", center: [29.06, 76.08], threatWeight: 1.2 },
  { name: "Bihar", code: "BR", center: [25.10, 85.31], threatWeight: 1.0 },
  { name: "Odisha", code: "OR", center: [20.95, 85.10], threatWeight: 0.8 },
  { name: "Assam", code: "AS", center: [26.20, 92.94], threatWeight: 0.7 },
  { name: "Jharkhand", code: "JH", center: [23.61, 85.28], threatWeight: 0.9 },
  { name: "Chhattisgarh", code: "CG", center: [21.27, 81.87], threatWeight: 0.7 },
  { name: "Uttarakhand", code: "UK", center: [30.07, 79.02], threatWeight: 0.6 },
  { name: "Himachal Pradesh", code: "HP", center: [31.10, 77.17], threatWeight: 0.5 },
  { name: "Goa", code: "GA", center: [15.40, 73.83], threatWeight: 0.6 },
  { name: "Tripura", code: "TR", center: [23.94, 91.99], threatWeight: 0.4 },
  { name: "Meghalaya", code: "ML", center: [25.47, 91.37], threatWeight: 0.4 },
  { name: "Manipur", code: "MN", center: [24.66, 93.91], threatWeight: 0.3 },
  { name: "Nagaland", code: "NL", center: [26.16, 94.56], threatWeight: 0.3 },
  { name: "Mizoram", code: "MZ", center: [23.16, 92.94], threatWeight: 0.3 },
  { name: "Arunachal Pradesh", code: "AR", center: [28.22, 94.73], threatWeight: 0.2 },
  { name: "Sikkim", code: "SK", center: [27.53, 88.51], threatWeight: 0.3 },
  { name: "Chandigarh", code: "CH", center: [30.73, 76.78], threatWeight: 0.8 },
  { name: "Puducherry", code: "PY", center: [11.94, 79.81], threatWeight: 0.5 },
  { name: "Jammu & Kashmir", code: "JK", center: [33.78, 76.57], threatWeight: 0.7 },
  { name: "Ladakh", code: "LA", center: [34.15, 77.58], threatWeight: 0.2 },
  { name: "Chhattisgarh", code: "CG", center: [21.27, 81.87], threatWeight: 0.7 },
];

export const CITIES: IndianCity[] = [
  { name: "Mumbai", state: "Maharashtra", stateCode: "MH", lat: 19.08, lng: 72.88, population: 20411000 },
  { name: "Delhi", state: "Delhi NCR", stateCode: "DL", lat: 28.61, lng: 77.23, population: 18980000 },
  { name: "Bangalore", state: "Karnataka", stateCode: "KA", lat: 12.97, lng: 77.59, population: 12327000 },
  { name: "Hyderabad", state: "Telangana", stateCode: "TS", lat: 17.39, lng: 78.49, population: 10004000 },
  { name: "Ahmedabad", state: "Gujarat", stateCode: "GJ", lat: 23.02, lng: 72.57, population: 8439000 },
  { name: "Chennai", state: "Tamil Nadu", stateCode: "TN", lat: 13.08, lng: 80.27, population: 10971000 },
  { name: "Kolkata", state: "West Bengal", stateCode: "WB", lat: 22.57, lng: 88.36, population: 14850000 },
  { name: "Pune", state: "Maharashtra", stateCode: "MH", lat: 18.52, lng: 73.86, population: 7420000 },
  { name: "Jaipur", state: "Rajasthan", stateCode: "RJ", lat: 26.91, lng: 75.79, population: 3909000 },
  { name: "Lucknow", state: "Uttar Pradesh", stateCode: "UP", lat: 26.85, lng: 80.95, population: 3382000 },
  { name: "Kanpur", state: "Uttar Pradesh", stateCode: "UP", lat: 26.45, lng: 80.35, population: 2768000 },
  { name: "Nagpur", state: "Maharashtra", stateCode: "MH", lat: 21.15, lng: 79.09, population: 2405000 },
  { name: "Indore", state: "Madhya Pradesh", stateCode: "MP", lat: 22.72, lng: 75.86, population: 1994000 },
  { name: "Thiruvananthapuram", state: "Kerala", stateCode: "KL", lat: 8.52, lng: 76.94, population: 942000 },
  { name: "Bhopal", state: "Madhya Pradesh", stateCode: "MP", lat: 23.26, lng: 77.41, population: 1883000 },
  { name: "Visakhapatnam", state: "Andhra Pradesh", stateCode: "AP", lat: 17.69, lng: 83.22, population: 1728000 },
  { name: "Patna", state: "Bihar", stateCode: "BR", lat: 25.60, lng: 85.10, population: 2046000 },
  { name: "Vadodara", state: "Gujarat", stateCode: "GJ", lat: 22.31, lng: 73.19, population: 1822000 },
  { name: "Surat", state: "Gujarat", stateCode: "GJ", lat: 21.17, lng: 72.83, population: 6081000 },
  { name: "Coimbatore", state: "Tamil Nadu", stateCode: "TN", lat: 11.01, lng: 76.97, population: 1601000 },
  { name: "Kochi", state: "Kerala", stateCode: "KL", lat: 9.93, lng: 76.27, population: 602000 },
  { name: "Chandigarh", state: "Chandigarh", stateCode: "CH", lat: 30.73, lng: 76.78, population: 1055000 },
  { name: "Amritsar", state: "Punjab", stateCode: "PB", lat: 31.63, lng: 74.87, population: 1183000 },
  { name: "Patiala",  state: "Punjab", stateCode: "PB", lat: 30.34, lng: 76.39, population: 426000 },
  { name: "Ludhiana", state: "Punjab", stateCode: "PB", lat: 30.90, lng: 75.85, population: 1618000 },

  { name: "Dehradun", state: "Uttarakhand", stateCode: "UK", lat: 30.32, lng: 78.03, population: 578000 },
  { name: "Guwahati", state: "Assam", stateCode: "AS", lat: 26.14, lng: 91.74, population: 957000 },
  { name: "Ranchi", state: "Jharkhand", stateCode: "JH", lat: 23.35, lng: 85.33, population: 1073000 },
  { name: "Raipur", state: "Chhattisgarh", stateCode: "CG", lat: 21.25, lng: 81.63, population: 1010000 },
  { name: "Bhubaneswar", state: "Odisha", stateCode: "OR", lat: 20.30, lng: 85.82, population: 837000 },
  { name: "Noida", state: "Uttar Pradesh", stateCode: "UP", lat: 28.57, lng: 77.33, population: 642000 },
  { name: "Gurugram", state: "Haryana", stateCode: "HR", lat: 28.46, lng: 77.03, population: 877000 },
  { name: "Navi Mumbai", state: "Maharashtra", stateCode: "MH", lat: 19.03, lng: 73.03, population: 1120000 },
  { name: "Thane", state: "Maharashtra", stateCode: "MH", lat: 19.22, lng: 72.98, population: 1841000 },
  { name: "Mysore", state: "Karnataka", stateCode: "KA", lat: 12.30, lng: 76.66, population: 920000 },
  { name: "Jodhpur", state: "Rajasthan", stateCode: "RJ", lat: 26.24, lng: 73.02, population: 1034000 },
  { name: "Madurai", state: "Tamil Nadu", stateCode: "TN", lat: 9.92, lng: 78.12, population: 1017000 },
  { name: "Varanasi", state: "Uttar Pradesh", stateCode: "UP", lat: 25.32, lng: 83.01, population: 1198000 },
  { name: "Agra", state: "Uttar Pradesh", stateCode: "UP", lat: 27.18, lng: 78.02, population: 1585000 },
  { name: "Nashik", state: "Maharashtra", stateCode: "MH", lat: 19.99, lng: 73.79, population: 1486000 },
  { name: "Vijayawada", state: "Andhra Pradesh", stateCode: "AP", lat: 16.51, lng: 80.63, population: 1040000 },
  { name: "Meerut", state: "Uttar Pradesh", stateCode: "UP", lat: 28.98, lng: 77.71, population: 1305000 },
  { name: "Faridabad", state: "Haryana", stateCode: "HR", lat: 28.41, lng: 77.32, population: 1394000 },
  { name: "Ghaziabad", state: "Uttar Pradesh", stateCode: "UP", lat: 28.67, lng: 77.42, population: 1636000 },
  { name: "Rajkot", state: "Gujarat", stateCode: "GJ", lat: 22.30, lng: 70.80, population: 1286000 },
  { name: "Kakinada", state: "Andhra Pradesh", stateCode: "AP", lat: 16.99, lng: 82.25, population: 312000 },
  { name: "Bilaspur", state: "Chhattisgarh", stateCode: "CG", lat: 22.08, lng: 82.15, population: 680000 },
  { name: "Shimla", state: "Himachal Pradesh", stateCode: "HP", lat: 31.10, lng: 77.17, population: 171000 },
  { name: "Panaji", state: "Goa", stateCode: "GA", lat: 15.50, lng: 73.83, population: 114000 },
  { name: "Gangtok", state: "Sikkim", stateCode: "SK", lat: 27.34, lng: 88.61, population: 100000 },
  { name: "Imphal", state: "Manipur", stateCode: "MN", lat: 24.82, lng: 93.95, population: 268000 },
  { name: "Aizawl", state: "Mizoram", stateCode: "MZ", lat: 23.73, lng: 92.72, population: 293000 },
];

export const TELECOM_CIRCLES: TelecomCircle[] = [
  { name: "Delhi", center: [28.61, 77.23], states: ["Delhi NCR", "Haryana"] },
  { name: "Mumbai", center: [19.08, 72.88], states: ["Maharashtra"] },
  { name: "Maharashtra & Goa", center: [18.52, 73.86], states: ["Maharashtra", "Goa"] },
  { name: "Gujarat", center: [22.26, 71.19], states: ["Gujarat"] },
  { name: "Andhra Pradesh", center: [15.91, 79.74], states: ["Andhra Pradesh"] },
  { name: "Karnataka", center: [15.32, 75.71], states: ["Karnataka"] },
  { name: "Tamil Nadu", center: [11.13, 78.06], states: ["Tamil Nadu", "Puducherry"] },
  { name: "Kerala", center: [10.85, 76.27], states: ["Kerala"] },
  { name: "Calcutta", center: [22.57, 88.36], states: ["West Bengal"] },
  { name: "Haryana", center: [29.06, 76.08], states: ["Haryana"] },
  { name: "Punjab", center: [31.15, 75.34], states: ["Punjab", "Chandigarh"] },
  { name: "UP (East)", center: [26.85, 80.95], states: ["Uttar Pradesh"] },
  { name: "UP (West)", center: [28.46, 77.03], states: ["Uttar Pradesh"] },
  { name: "Madhya Pradesh", center: [22.97, 78.66], states: ["Madhya Pradesh", "Chhattisgarh"] },
  { name: "Rajasthan", center: [27.02, 74.22], states: ["Rajasthan"] },
  { name: "Bihar", center: [25.10, 85.31], states: ["Bihar", "Jharkhand"] },
  { name: "Orissa", center: [20.95, 85.10], states: ["Odisha"] },
  { name: "Assam", center: [26.20, 92.94], states: ["Assam", "Meghalaya", "Nagaland", "Manipur", "Mizoram", "Arunachal Pradesh", "Sikkim", "Tripura"] },
  { name: "Jammu & Kashmir", center: [33.78, 76.57], states: ["Jammu & Kashmir", "Ladakh"] },
  { name: "Himachal Pradesh", center: [31.10, 77.17], states: ["Himachal Pradesh"] },
  { name: "Tamil Nadu", center: [11.01, 76.97], states: ["Tamil Nadu"] },
  { name: "Kolkata", center: [22.57, 88.36], states: ["West Bengal"] },
];

/**
 * Generate a random location within India, weighted by population and threat data.
 */
export function randomIndianLocation(): IndianCity {
  // Weight cities by population * threat weight
  const stateWeights = new Map<string, number>();
  for (const state of INDIAN_STATES) {
    stateWeights.set(state.code, state.threatWeight);
  }

  // Weighted random selection favoring high-population, high-threat cities
  const weightedCities = CITIES.map((city) => ({
    ...city,
    weight: city.population * (stateWeights.get(city.stateCode) || 1),
  }));

  const totalWeight = weightedCities.reduce((sum, c) => sum + c.weight, 0);
  let random = Math.random() * totalWeight;

  for (const city of weightedCities) {
    random -= city.weight;
    if (random <= 0) return city;
  }

  return CITIES[0]; // fallback
}

/**
 * Get the state for given coordinates (approximate).
 */
export function stateForCoordinates(lat: number, lng: number): IndianState | undefined {
  let closest: IndianState | undefined;
  let minDist = Infinity;

  for (const state of INDIAN_STATES) {
    const [slat, slng] = state.center;
    const dist = Math.sqrt((lat - slat) ** 2 + (lng - slng) ** 2);
    if (dist < minDist) {
      minDist = dist;
      closest = state;
    }
  }

  return closest;
}
