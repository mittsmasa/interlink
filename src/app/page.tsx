import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-50">
      <main className="container mx-auto px-4 py-8">
        <h1 className="text-4xl font-bold text-gray-900 mb-8">InterLink</h1>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Link
            href="/system-dynamics"
            className="block p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow"
          >
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              システムダイナミクス
            </h2>
            <p className="text-gray-600">
              インタラクティブなシステムダイナミクスモデルを作成・編集できます
            </p>
          </Link>
        </div>
      </main>
    </div>
  );
}
