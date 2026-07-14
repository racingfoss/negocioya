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
