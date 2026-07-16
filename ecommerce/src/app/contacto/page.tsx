import type { Metadata } from "next";
import { getConfiguracionTienda } from "@/lib/api";
import ContactForm from "./ContactForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Contacto" };

export default async function ContactoPage() {
  const config = await getConfiguracionTienda();

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="font-serif text-3xl text-[#2a231f]">Contacto</h1>
      <p className="text-[#6b6058]">
        ¿Tenés una consulta? Escribinos y te respondemos a la brevedad.
      </p>
      <ContactForm email={config.email_contacto} />
    </div>
  );
}
