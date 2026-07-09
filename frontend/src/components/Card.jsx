const borderColors = {
  green: 'border-green-500',
  blue: 'border-blue-500',
  red: 'border-red-500',
  yellow: 'border-yellow-500',
  purple: 'border-purple-500',
}

export default function Card({ title, value, color = 'green' }) {
  return (
    <div className={`bg-[#151b2b] rounded-xl border-l-4 ${borderColors[color]} p-4 shadow`}>
      <p className="text-xs uppercase tracking-wide text-gray-400">{title}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  )
}
