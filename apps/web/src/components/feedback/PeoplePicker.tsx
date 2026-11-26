import { X } from "lucide-react";
import { SearchSelect } from "@/components/ui/search-select";

/** Pick several people: a search box, then chips you can remove. */
export function PeoplePicker({ value, onChange, people, max = 10, placeholder = "Search colleagues" }: { value: string[]; onChange: (v: string[]) => void; people: { id: string; name: string; hint?: string }[]; max?: number; placeholder?: string }) {
  const byId = new Map(people.map((p) => [p.id, p]));
  return (
    <div className="flex flex-col gap-2">
      <SearchSelect value="" onChange={(id) => id && !value.includes(id) && value.length < max && onChange([...value, id])} options={people.filter((p) => !value.includes(p.id)).map((p) => ({ value: p.id, label: p.name, hint: p.hint }))} placeholder={value.length >= max ? `Up to ${max} people` : placeholder} disabled={value.length >= max} aria-label={placeholder} />
      {value.length ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <span key={id} className="tag tag-accent gap-1">{byId.get(id)?.name}<button type="button" className="ms-1 inline-flex cursor-pointer border-0 bg-transparent p-0 text-inherit" aria-label={`Remove ${byId.get(id)?.name}`} onClick={() => onChange(value.filter((x) => x !== id))}><X size={12} /></button></span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
