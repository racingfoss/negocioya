import type { Metadata } from "next";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import WhatsAppButton from "@/components/WhatsAppButton";
import { getConfiguracionTienda } from "@/lib/api";
import "./globals.css";

// El layout ahora hace fetch a FashBalance (nombre/WhatsApp/redes de la tienda). Sin esto, "next
// build" intenta pre-renderizar estáticamente rutas como /_not-found y falla en build time, cuando
// ni el backend ni las env vars de runtime están disponibles todavía.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const config = await getConfiguracionTienda();
  return {
    title: `${config.nombre_ecommerce} — Tienda`,
    description: "Indumentaria femenina. Mirá nuestros productos y consultanos por WhatsApp.",
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const config = await getConfiguracionTienda();

  return (
    <html lang="es">
      <body className="flex min-h-screen flex-col font-sans">
        <Header
          nombreTienda={config.nombre_ecommerce}
          instagram={config.instagram_url}
          facebook={config.facebook_url}
        />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
        <Footer
          nombreTienda={config.nombre_ecommerce}
          instagram={config.instagram_url}
          facebook={config.facebook_url}
        />
        <WhatsAppButton
          numero={config.whatsapp_numero}
          mensaje="Hola! Quería consultar por sus productos."
        />
      </body>
    </html>
  );
}
