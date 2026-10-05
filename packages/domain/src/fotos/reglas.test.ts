import { describe, it, expect } from "vitest";
import {
  validarFoto,
  rutaAlmacenamiento,
  extensionDe,
  puedeBorrarFoto,
  TAMANO_MAXIMO_BYTES,
  MAXIMO_POR_POSICION,
  MAXIMO_POR_ORDEN,
  type SolicitudFoto,
} from "./reglas";

const base: SolicitudFoto = {
  tipoMime: "image/jpeg",
  tamanoBytes: 220_000,
  nombreArchivo: "posicion-7.jpg",
  existentes: 0,
  posicion: 7,
};

describe("validación de la foto", () => {
  it("acepta una foto ya comprimida", () => {
    expect(validarFoto(base).permitido).toBe(true);
  });

  it("acepta los tres formatos de imagen", () => {
    for (const tipoMime of ["image/jpeg", "image/png", "image/webp"]) {
      expect(validarFoto({ ...base, tipoMime }).permitido).toBe(true);
    }
  });

  it("rechaza lo que no es imagen", () => {
    expect(validarFoto({ ...base, tipoMime: "application/pdf" }).codigo).toBe("TIPO_NO_PERMITIDO");
    expect(validarFoto({ ...base, tipoMime: "video/mp4" }).codigo).toBe("TIPO_NO_PERMITIDO");
  });

  it("rechaza una foto sin comprimir", () => {
    // Una foto de celular pesa 3-5 MB. Veintidós posiciones serían más de
    // 60 MB por orden en 4G rural.
    const r = validarFoto({ ...base, tamanoBytes: 4_000_000 });
    expect(r.codigo).toBe("ARCHIVO_MUY_GRANDE");
    expect(r.mensaje).toContain("Comprímela");
  });

  it("acepta justo en el límite", () => {
    expect(validarFoto({ ...base, tamanoBytes: TAMANO_MAXIMO_BYTES }).permitido).toBe(true);
    expect(validarFoto({ ...base, tamanoBytes: TAMANO_MAXIMO_BYTES + 1 }).codigo).toBe(
      "ARCHIVO_MUY_GRANDE",
    );
  });

  it("rechaza un archivo vacío", () => {
    expect(validarFoto({ ...base, tamanoBytes: 0 }).codigo).toBe("ARCHIVO_VACIO");
  });

  it("rechaza un nombre en blanco", () => {
    expect(validarFoto({ ...base, nombreArchivo: "   " }).codigo).toBe("SIN_NOMBRE");
  });
});

describe("topes de cantidad", () => {
  it("limita las fotos por posición", () => {
    // Más fotos de la misma llanta no agregan evidencia.
    const enElTope = validarFoto({ ...base, existentes: MAXIMO_POR_POSICION - 1 });
    expect(enElTope.permitido).toBe(true);

    const pasado = validarFoto({ ...base, existentes: MAXIMO_POR_POSICION });
    expect(pasado.codigo).toBe("DEMASIADAS_FOTOS");
    expect(pasado.mensaje).toContain("posición 7");
  });

  it("la orden completa admite más que una posición", () => {
    const deOrden = { ...base, posicion: null };
    expect(validarFoto({ ...deOrden, existentes: MAXIMO_POR_POSICION }).permitido).toBe(true);
    expect(validarFoto({ ...deOrden, existentes: MAXIMO_POR_ORDEN }).codigo).toBe(
      "DEMASIADAS_FOTOS",
    );
  });

  it("el mensaje distingue la orden de la posición", () => {
    const deOrden = validarFoto({ ...base, posicion: null, existentes: MAXIMO_POR_ORDEN });
    expect(deOrden.mensaje).toContain("esta orden");
  });
});

describe("ruta en el almacenamiento", () => {
  const p = {
    empresaId: "emp-1",
    ordenId: "ord-9",
    fotoId: "f-abc",
    posicion: 7,
    tipoMime: "image/jpeg",
  };

  it("empieza por la empresa", () => {
    // El prefijo permite separar por tenant al copiar o al dar de baja una
    // empresa completa.
    expect(rutaAlmacenamiento(p).startsWith("emp-1/")).toBe(true);
  });

  it("separa por orden y posición", () => {
    expect(rutaAlmacenamiento(p)).toBe("emp-1/ord-9/posicion-7/f-abc.jpg");
  });

  it("las fotos del vehículo van en su propia carpeta", () => {
    expect(rutaAlmacenamiento({ ...p, posicion: null })).toBe("emp-1/ord-9/orden/f-abc.jpg");
  });

  it("usa el id de la foto, no el nombre del archivo", () => {
    // Dos fotos llamadas IMG_0001.jpg no se pisan.
    const a = rutaAlmacenamiento({ ...p, fotoId: "f-1" });
    const b = rutaAlmacenamiento({ ...p, fotoId: "f-2" });
    expect(a).not.toBe(b);
  });

  it("la extensión sigue al tipo MIME", () => {
    expect(extensionDe("image/png")).toBe("png");
    expect(extensionDe("image/webp")).toBe("webp");
    expect(extensionDe("image/jpeg")).toBe("jpg");
  });
});

describe("borrado de fotos", () => {
  it("el autor puede borrar mientras la orden admite cambios", () => {
    expect(puedeBorrarFoto({ esAutor: true, ordenEditable: true }).permitido).toBe(true);
  });

  it("nadie borra una foto de una orden ya aprobada", () => {
    // Después de aprobar, la evidencia es parte del expediente: quitarla
    // sería alterar lo que el cliente firmó.
    const r = puedeBorrarFoto({ esAutor: true, ordenEditable: false });
    expect(r.codigo).toBe("ORDEN_NO_EDITABLE");
  });

  it("otro técnico no borra fotos ajenas", () => {
    expect(puedeBorrarFoto({ esAutor: false, ordenEditable: true }).codigo).toBe("NO_ES_AUTOR");
  });

  it("el estado de la orden pesa más que la autoría", () => {
    expect(puedeBorrarFoto({ esAutor: false, ordenEditable: false }).codigo).toBe(
      "ORDEN_NO_EDITABLE",
    );
  });
});
