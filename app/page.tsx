// TEMPORARY scaffold landing — replaced in Task 3 by the protected app/(app)/ group,
// which owns the "/" route behind the auth gate. Kept here only so `next build` has a
// routable page during Task 1.
export default function ScaffoldHome() {
  return (
    <main className="mx-auto max-w-xl p-10">
      <h1 className="text-xl font-semibold">Marketing Expense Tracker</h1>
      <p className="mt-2 text-sm text-neutral-600">Walking skeleton — scaffolding in progress.</p>
    </main>
  );
}
