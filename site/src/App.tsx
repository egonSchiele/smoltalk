import { useEffect, useMemo, useState } from "react";
import { Controls } from "./components/Controls";
import { ModelSection } from "./components/ModelSection";
import {
  embeddingsColumns,
  imageColumns,
  speechToTextColumns,
  textColumns,
  textToSpeechColumns,
} from "./columns";
import { collectProviders, filterModels, type Filterable } from "./filter";
import { modelData } from "./types";
import { filterToQuery, parseFilter } from "./url";

const {
  text,
  image,
  embeddings,
  speechToText,
  textToSpeech,
  generatedAt,
  smoltalkVersion,
} = modelData;

/**
 * Embeddings models carry no `disabled` field, so they widen to Filterable
 * without one. Collecting across every type keeps the provider list and the
 * deprecated count honest for the page as a whole.
 */
const everyModel: Filterable[] = [
  ...text,
  ...image,
  ...embeddings,
  ...speechToText,
  ...textToSpeech,
];

const providers = collectProviders(everyModel);
const deprecatedCount = everyModel.filter((model) => model.disabled).length;

export function App() {
  const [filter, setFilter] = useState(() =>
    parseFilter(window.location.search),
  );

  // Keep the address bar in step with the controls, without adding a history
  // entry for every keystroke.
  useEffect(() => {
    const query = filterToQuery(filter);
    window.history.replaceState(null, "", `${window.location.pathname}${query}`);
  }, [filter]);

  const generated = useMemo(
    () =>
      new Date(generatedAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    [],
  );

  const matchCount = filterModels(everyModel, filter).length;

  return (
    <div className="page">
      <header>
        <h1>smoltalk models</h1>
        <p className="subtitle">
          Every model in the registry. Click a column to sort; costs are USD per
          million tokens unless the header says otherwise.
        </p>
      </header>

      <Controls
        filter={filter}
        providers={providers}
        deprecatedCount={deprecatedCount}
        onChange={setFilter}
      />

      {matchCount === 0 ? (
        <p className="empty">
          No models match. Try clearing the search or the provider filter.
        </p>
      ) : (
        <>
          <ModelSection
            title="Text"
            rows={text}
            columns={textColumns}
            filter={filter}
          />
          <ModelSection
            title="Image"
            rows={image}
            columns={imageColumns}
            filter={filter}
          />
          <ModelSection
            title="Embeddings"
            rows={embeddings}
            columns={embeddingsColumns}
            filter={filter}
          />
          <ModelSection
            title="Speech to text"
            rows={speechToText}
            columns={speechToTextColumns}
            filter={filter}
          />
          <ModelSection
            title="Text to speech"
            rows={textToSpeech}
            columns={textToSpeechColumns}
            filter={filter}
          />
        </>
      )}

      <footer>
        Generated from smoltalk v{smoltalkVersion} on {generated}.{" "}
        <a href="https://github.com/egonSchiele/smoltalk">Source</a>
      </footer>
    </div>
  );
}
