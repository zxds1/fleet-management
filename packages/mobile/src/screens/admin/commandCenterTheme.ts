import type { TextStyle } from "react-native";
import { commandColors, commandSpacing, mono } from "../../theme/commandColors";

export const colors = commandColors;
export { commandColors, commandSpacing, mono };

export const darkMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#15151A" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#676771" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#15151A" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#2A2A31" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#18181D" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#55555E" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#303038" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#1D1D23" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#3B3B45" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#202027" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0C1118" }] },
];
