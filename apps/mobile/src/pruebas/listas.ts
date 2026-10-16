import { fireEvent, screen, waitFor } from "@testing-library/react";

/**
 * Los desplegables (`ListaBuscable`, `ElegirUno`, `ElegirVarios`) se ven
 * cerrados hasta que se tocan, como en el teléfono. Estos ayudantes hacen lo
 * que haría la persona: abrir la lista y tocar la opción.
 */

const CERRADA_SIN_ELEGIR = /Tocar para elegir$/;
const CERRADA = /Tocar para (elegir|cambiar)$/;

/** Abre los desplegables cerrados; con `todas`, también los que ya tienen algo elegido. */
export function abrirListas(todas = false): void {
  for (const b of screen.queryAllByLabelText(todas ? CERRADA : CERRADA_SIN_ELEGIR)) fireEvent.click(b);
}

type Cual = string | RegExp | { testID: string } | { label: string };

function buscar(cual: Cual): HTMLElement | null {
  if (typeof cual === "object" && "testID" in cual) return screen.queryByTestId(cual.testID);
  if (typeof cual === "object" && "label" in cual) return screen.queryAllByLabelText(cual.label)[0] ?? null;
  return screen.queryAllByText(cual)[0] ?? null;
}

/** Abre lo que haga falta y toca la opción (por su texto o por su testID). */
export async function elegirOpcion(cual: Cual): Promise<void> {
  let el: HTMLElement | null = null;
  await waitFor(() => {
    el = buscar(cual);
    if (!el) {
      abrirListas();
      el = buscar(cual);
    }
    if (!el) {
      abrirListas(true);
      el = buscar(cual);
    }
    if (!el) throw new Error(`No aparece la opción ${JSON.stringify(cual instanceof RegExp ? String(cual) : cual)}`);
    // Las listas en cascada se cargan solas; con la suite completa corriendo
    // en paralelo, un segundo (el valor por defecto) a veces no alcanzaba.
  }, { timeout: 5000 });
  fireEvent.click(el as unknown as HTMLElement);
}

/** Abre un desplegable por su testID (el de la lista, sin "-abrir"), si está cerrado. */
export function abrirLista(testID: string): void {
  const b = screen.queryByTestId(`${testID}-abrir`);
  if (b) fireEvent.click(b);
}
