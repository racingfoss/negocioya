function whatsappHref(numero: string, mensaje: string): string {
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`;
}

export default function WhatsAppButton({
  numero,
  mensaje,
}: {
  numero: string | null;
  mensaje: string;
}) {
  if (!numero) return null;

  return (
    <a
      href={whatsappHref(numero, mensaje)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Escribinos por WhatsApp"
      className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg shadow-black/20 transition-transform hover:scale-105"
    >
      <svg viewBox="0 0 32 32" className="h-7 w-7" fill="currentColor" aria-hidden="true">
        <path d="M16.004 3C9.377 3 4 8.373 4 15c0 2.34.658 4.523 1.8 6.383L4 29l7.86-1.755A11.94 11.94 0 0 0 16.004 27C22.63 27 28 21.627 28 15S22.63 3 16.004 3Zm0 21.7c-1.98 0-3.83-.57-5.39-1.552l-.386-.24-4.66 1.04 1.02-4.54-.252-.404A9.65 9.65 0 0 1 6.3 15c0-5.354 4.352-9.7 9.704-9.7 5.352 0 9.7 4.346 9.7 9.7 0 5.354-4.348 9.7-9.7 9.7Zm5.32-7.264c-.29-.146-1.716-.847-1.982-.944-.266-.096-.46-.145-.653.146-.194.29-.75.943-.92 1.137-.17.194-.34.218-.63.073-.29-.146-1.224-.451-2.332-1.437-.862-.768-1.444-1.716-1.613-2.006-.17-.29-.018-.447.128-.591.13-.13.29-.34.435-.51.145-.17.194-.29.29-.484.097-.194.049-.363-.024-.508-.073-.146-.653-1.574-.895-2.155-.236-.567-.476-.49-.653-.5l-.556-.01c-.194 0-.508.073-.774.363-.266.29-1.016.994-1.016 2.423 0 1.43 1.04 2.81 1.186 3.005.145.194 2.048 3.128 4.963 4.386.694.3 1.235.479 1.657.613.696.221 1.33.19 1.83.115.558-.083 1.716-.702 1.958-1.38.242-.678.242-1.259.17-1.38-.073-.121-.266-.194-.556-.34Z" />
      </svg>
    </a>
  );
}
