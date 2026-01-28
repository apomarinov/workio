# Plan: Image Support in Session Transcripts

## Overview

Add support for storing and displaying images that are embedded in Claude Code session transcripts.

## Current State

### Transcript Entry Structure (from JSONL files)

```typescript
interface TranscriptEntry {
  parentUuid: string
  isSidechain: boolean
  userType: string
  cwd: string
  sessionId: string
  version: string
  gitBranch: string
  type: string  // "user" | "assistant"
  message: {
    role: string
    content: Content[]  // Array of content items
  }
  uuid: string
  timestamp: string
  thinkingMetadata: ThinkingMetadata
  todos: any[]
  imagePasteIds: number[]  // Indicates images were pasted
  permissionMode: string
}

interface Content {
  type: string      // "text" | "image"
  text?: string     // For type="text"
  source?: {        // For type="image"
    type: string    // "base64"
    media_type: string  // "image/png", "image/jpeg", etc.
    data: string    // Base64-encoded image data
  }
}
```

### Current Processing (worker.py)

**Problem:** Lines 434-442 only extract the FIRST content item:

```python
content_list = message.get('content', [])
if content_list and len(content_list) > 0:
    first_content = content_list[0]
    content_type = first_content.get('type')
    if content_type == 'text':
        body = first_content.get('text')
```

Images in the content array are completely ignored.

### Current Database Schema (schema.sql)

```sql
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    prompt_id INTEGER,
    uuid TEXT UNIQUE,
    is_user BOOLEAN DEFAULT 0,
    thinking BOOLEAN DEFAULT 0,
    todo_id TEXT,
    body TEXT,           -- Only stores text content
    tools JSON,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

No column for image data.

---

## Proposed Solution

### Option A: Store images as separate column (Recommended)

Store base64 image data in a new `images` JSON column alongside `body`.

**Pros:**
- Simple schema change
- Easy to query messages with images
- Maintains separation of concerns

**Cons:**
- Large base64 strings in database
- Could impact query performance for message lists

### Option B: Store images as files, reference in database

Save images to filesystem, store file paths in database.

**Pros:**
- Smaller database size
- Can serve images directly via static file serving

**Cons:**
- More complex implementation
- Need to manage file lifecycle (cleanup)
- Need new API endpoint or static file route

### Option C: Store images inline in body as data URIs

Embed images directly into the body as markdown with data URIs.

**Pros:**
- No schema changes
- Works with existing markdown rendering

**Cons:**
- Mixes content types
- Harder to query/filter
- Very large body strings

**Recommendation:** Option A - cleanest separation while keeping implementation simple.

---

## Implementation Plan

### Phase 1: Database Schema Update

**File: `schema.sql`**

```sql
-- Add images column to messages table
ALTER TABLE messages ADD COLUMN images JSON;
```

The `images` column will store:
```json
[
  {
    "media_type": "image/png",
    "data": "base64-encoded-data..."
  }
]
```

### Phase 2: Worker Processing Update

**File: `worker.py`**

Modify `process_transcript()` (Pass 4, lines 392-461) to:

1. Extract ALL content items, not just the first
2. Collect text items and concatenate them
3. Collect image items separately
4. Store images in new column

```python
# Pseudocode for updated logic
text_parts = []
images = []

for content_item in content_list:
    if content_item.get('type') == 'text':
        text_parts.append(content_item.get('text', ''))
    elif content_item.get('type') == 'image':
        source = content_item.get('source', {})
        images.append({
            'media_type': source.get('media_type'),
            'data': source.get('data')
        })

body = '\n'.join(text_parts) if text_parts else None
images_json = json.dumps(images) if images else None
```

### Phase 3: Type Updates

**File: `app/src/types.ts`**

```typescript
export interface MessageImage {
  media_type: string  // "image/png", "image/jpeg", etc.
  data: string        // Base64-encoded image data
}

export interface Message {
  id: number
  prompt_id: number
  uuid: string
  is_user: boolean
  thinking: boolean
  todo_id: string | null
  body: string | null
  tools: ToolData | null
  images: MessageImage[] | null  // NEW
  created_at: string
  updated_at: string | null
}
```

### Phase 4: Server Updates

**File: `app/server/db.ts`**

Update `getSessionMessages()` to include and parse `images` column:

```typescript
const messages = db.prepare(`
  SELECT
    m.id, m.prompt_id, m.uuid, m.is_user, m.thinking,
    m.todo_id, m.body, m.tools, m.images, m.created_at, m.updated_at,
    p.prompt as prompt_text
  FROM messages m
  JOIN prompts p ON m.prompt_id = p.id
  WHERE p.session_id = ?
  ORDER BY COALESCE(m.updated_at, m.created_at) DESC
  LIMIT ? OFFSET ?
`).all(sessionId, limit, offset)

const parsedMessages = messages.map((m) => ({
  ...m,
  is_user: Boolean(m.is_user),
  thinking: Boolean(m.thinking),
  tools: m.tools ? JSON.parse(m.tools) : null,
  images: m.images ? JSON.parse(m.images) : null,  // NEW
}))
```

### Phase 5: Frontend Display

**File: `app/src/components/MessageBubble.tsx`**

Add image rendering to MessageBubble:

```tsx
export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.is_user

  // Handle tool messages
  if (message.tools) {
    return <ToolCallDisplay tool={message.tools} />
  }

  return (
    <div className={...}>
      {/* Render images if present */}
      {message.images && message.images.length > 0 && (
        <div className="message-images">
          {message.images.map((img, idx) => (
            <img
              key={idx}
              src={`data:${img.media_type};base64,${img.data}`}
              alt={`Attached image ${idx + 1}`}
              className="message-image"
            />
          ))}
        </div>
      )}

      {/* Render text content */}
      {displayText && (
        isUser
          ? <span>{displayText}</span>
          : <MarkdownContent content={displayText} />
      )}
    </div>
  )
}
```

**Styling considerations:**
- Max-width for images (e.g., 100% of bubble, max 600px)
- Click to expand/zoom
- Lazy loading for performance
- Consider thumbnails for very large images

---

## Migration Strategy

1. Add `images` column to schema (nullable, no migration needed for existing data)
2. Deploy worker changes - new transcripts will have images populated
3. Deploy frontend changes - gracefully handles null images
4. Optionally: Re-process existing transcripts to extract images

---

## Files to Modify

| File | Changes |
|------|---------|
| `schema.sql` | Add `images JSON` column |
| `worker.py` | Extract images from content array, store in new column |
| `app/src/types.ts` | Add `MessageImage` interface, update `Message` |
| `app/server/db.ts` | Parse images JSON in query results |
| `app/src/components/MessageBubble.tsx` | Render images in message bubbles |

---

## Performance Considerations

1. **Database size**: Base64 images are ~33% larger than binary. A 1MB image becomes ~1.3MB in the database.

2. **Query performance**: Consider not selecting `images` column in list views, only when viewing individual messages.

3. **Frontend memory**: Large images could cause memory issues. Consider:
   - Lazy loading with IntersectionObserver
   - Progressive loading (show placeholder first)
   - Optional: Generate thumbnails

4. **Alternative for large scale**: Store images as files and serve via `/api/images/:id` endpoint. This would require additional complexity but better performance.

---

## Future Enhancements

1. Image thumbnails for message list view
2. Lightbox/modal for full-size image viewing
3. Image download functionality
4. Support for other content types (documents, code blocks with syntax)
