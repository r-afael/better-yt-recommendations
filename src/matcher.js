// Scores how close videos are to the user's topics by comparing their text embeddings.
// Pure logic: the embedding model is passed in, so this runs anywhere.
(() => {
  "use strict";

  const DEFAULT_CACHE_SIZE = 2000; // Video vectors kept between requests, enough for a long viewing session.
  const DEFAULT_BATCH_SIZE = 32; // Texts per model call, which bounds the memory of one inference.
  const TOPIC_LISTS_KEPT = 4; // The wanted and avoided lists, plus the previous pair while they are edited.

  // The vectors are L2-normalized, so their dot product is their cosine similarity.
  function dot(a, b) {
    let sum = 0;
    for (let index = 0; index < a.length; index += 1) sum += a[index] * b[index];
    return sum;
  }

  function videoText({ title, channel }) {
    return channel ? `${title} | ${channel}` : title;
  }

  function chunk(items, size) {
    const chunks = [];
    for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size));
    return chunks;
  }

  // A Map that forgets its least recently used entries beyond capacity.
  function createLruCache(capacity) {
    const entries = new Map();
    return {
      get(key) {
        if (!entries.has(key)) return undefined;
        const value = entries.get(key);
        entries.delete(key);
        entries.set(key, value);
        return value;
      },
      set(key, value) {
        entries.delete(key);
        entries.set(key, value);
        if (entries.size > capacity) entries.delete(entries.keys().next().value);
      },
    };
  }

  function createMatcher({
    embed,
    cacheSize = DEFAULT_CACHE_SIZE,
    batchSize = DEFAULT_BATCH_SIZE,
  }) {
    const videoVectors = createLruCache(cacheSize);
    const topicVectors = createLruCache(TOPIC_LISTS_KEPT);

    // Returns a Map from each distinct text to its vector, embedding batchSize texts at a time.
    async function embedAll(texts) {
      const vectors = new Map();
      for (const batch of chunk([...new Set(texts)], batchSize)) {
        const embedded = await embed(batch);
        batch.forEach((text, index) => vectors.set(text, embedded[index]));
      }
      return vectors;
    }

    // Topics rarely change between requests, so the vectors of the latest lists are kept.
    async function vectorsForTopics(topics) {
      const key = JSON.stringify(topics);
      const cached = topicVectors.get(key);
      if (cached) return cached;
      const vectors = await embedAll(topics);
      const list = topics.map((topic) => vectors.get(topic));
      topicVectors.set(key, list);
      return list;
    }

    // Collects the vectors locally so a request larger than the cache still has all of them.
    async function vectorsForTexts(texts) {
      const vectors = new Map();
      for (const text of texts) {
        const cached = videoVectors.get(text);
        if (cached) vectors.set(text, cached);
      }
      const fresh = await embedAll(texts.filter((text) => !vectors.has(text)));
      for (const [text, vector] of fresh) {
        videoVectors.set(text, vector);
        vectors.set(text, vector);
      }
      return vectors;
    }

    // Resolves to { [id]: score }, the video's highest similarity to any topic, from -1 to 1.
    // topics must not be empty: offscreen.js scoreLists skips an empty list and gives null.
    async function score(topics, videos) {
      const topicList = await vectorsForTopics(topics);
      const texts = videos.map((video) => videoText(video));
      const vectors = await vectorsForTexts(texts);
      return Object.fromEntries(videos.map(({ id }, index) => {
        const vector = vectors.get(texts[index]);
        return [id, Math.max(...topicList.map((topic) => dot(topic, vector)))];
      }));
    }

    return Object.freeze({ score });
  }

  globalThis.BetterYT ??= {};
  globalThis.BetterYT.matcher = Object.freeze({ createMatcher });
})();
