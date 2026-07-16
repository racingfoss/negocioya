"use client";

import { useState } from "react";

export default function ContactForm({ email }: { email: string | null }) {
  const [nombre, setNombre] = useState("");
  const [emailRemitente, setEmailRemitente] = useState("");
  const [mensaje, setMensaje] = useState("");

  if (!email) {
    return (
      <p className="rounded-lg bg-[#f0e9df] px-4 py-3 text-sm text-[#6b6058]">
        Todavía no configuramos un email de contacto — escribinos por WhatsApp mientras tanto (el botón
        flotante de la esquina).
      </p>
    );
  }

  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    const asunto = `Consulta de ${nombre || "un cliente"}`;
    const cuerpo = `${mensaje}${emailRemitente ? `\n\nResponder a: ${emailRemitente}` : ""}`;
    window.location.href = `mailto:${email}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
  };

  return (
    <form onSubmit={enviar} className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-[#2a231f]">Nombre</label>
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
          className="w-full rounded-lg border border-[#e8ded2] bg-white px-3 py-2 text-[#2a231f]"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-[#2a231f]">Tu email</label>
        <input
          type="email"
          value={emailRemitente}
          onChange={(e) => setEmailRemitente(e.target.value)}
          className="w-full rounded-lg border border-[#e8ded2] bg-white px-3 py-2 text-[#2a231f]"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-[#2a231f]">Mensaje</label>
        <textarea
          value={mensaje}
          onChange={(e) => setMensaje(e.target.value)}
          required
          rows={4}
          className="w-full rounded-lg border border-[#e8ded2] bg-white px-3 py-2 text-[#2a231f]"
        />
      </div>
      <button
        type="submit"
        className="rounded-full bg-[#b5473a] px-6 py-3 font-medium text-white hover:bg-[#8a362c]"
      >
        Enviar consulta
      </button>
    </form>
  );
}
