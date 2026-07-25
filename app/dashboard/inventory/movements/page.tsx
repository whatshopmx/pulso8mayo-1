import { Metadata } from "next";
import { MovementsClient } from "./movements-client";

export const metadata: Metadata = {
  title: "Movimientos de Inventario | Pulso",
};

export default function MovementsPage() {
  return <MovementsClient />;
}
