import { IconBookOpen } from '../components/Icons'

export default function SopPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-full px-8 py-20 text-center bg-gray-50">
      <IconBookOpen className="w-12 h-12 text-gray-300 mb-4" />
      <h1 className="text-base font-semibold text-gray-700 mb-2">Standard Operating Procedures</h1>
      <p className="text-sm text-gray-400 max-w-xs">
        This section is being set up. SOPs and guides will be published here for reference.
      </p>
    </div>
  )
}
