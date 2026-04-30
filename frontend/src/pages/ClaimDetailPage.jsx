import { useParams } from 'react-router-dom'
export default function ClaimDetailPage() {
  const { id } = useParams()
  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-4">Claim Detail</h1>
      <p className="text-gray-500">Claim ID: {id}</p>
    </div>
  )
}
