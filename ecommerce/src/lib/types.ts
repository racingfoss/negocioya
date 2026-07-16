export interface Foto {
  id: number;
  producto_id: number;
  ruta_archivo: string;
  orden: number;
}

export interface ValorEnVariante {
  atributo_id: number;
  atributo: string;
  valor_atributo_id: number;
  valor: string;
}

export interface Variante {
  id: number;
  producto_id: number;
  activo: boolean;
  stock_actual: number;
  valores: ValorEnVariante[];
}

export interface ProductoCatalogo {
  id: number;
  nombre: string;
  descripcion_ecommerce: string | null;
  precio_venta: string;
  categoria: string | null;
  fotos: Foto[];
  tiene_variantes: boolean;
  stock_actual: number | null;
  variantes: Variante[] | null;
}

export interface ConfiguracionTienda {
  nombre_ecommerce: string;
  whatsapp_numero: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  email_contacto: string | null;
}

export interface CartItem {
  producto_id: number;
  variante_id: number | null;
  nombre: string;
  foto: string | null; // URL ya resuelta (mismo criterio que las fotos de ProductGallery)
  variante_descripcion: string | null; // ej. "M / Verde", armado una sola vez al agregar
  precio_venta: number; // snapshot numérico al agregar, solo para mostrar —
  // el backend recalcula el total real con el precio_venta actual del producto
  cantidad: number;
  stock_actual: number; // tope conocido al agregar, para acotar cantidad client-side
}

export interface DatosContactoCheckout {
  cliente_nombre: string;
  cliente_email?: string;
  cliente_telefono?: string;
  forma_entrega: "Retiro en persona" | "Envío";
  direccion_envio?: string;
  notas?: string;
  metodo_pago_preferido?: string;
}

export type ResultadoCheckout = { ok: true; ordenId: number } | { ok: false; error: string };
