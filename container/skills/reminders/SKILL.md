# Reminders & Todos Skill

You can manage reminders and todos for the user via natural language.

## API

All tools communicate with the reminder API at `http://host.containers.internal:3457`.

The user's `chat_jid` is available in your context as the group JID for this conversation.

## Tools

### create_reminder
Create a reminder that fires at a specific time.

```bash
curl -s -X POST http://host.containers.internal:3457/reminders \
  -H "Content-Type: application/json" \
  -d '{"chat_jid":"<chat_jid>","text":"<reminder text>","due_at":"<ISO8601 datetime>","recurrence":"<daily|weekly|monthly|null>"}'
```

Parse the user's intent carefully:
- "tomorrow at 3pm" → calculate the ISO8601 datetime in Europe/London timezone
- "every Monday at 9am" → recurrence: "weekly", due_at: next Monday at 9am
- "in 2 hours" → due_at: now + 2 hours

### create_todo
Create a todo item (no fixed time, user pulls their list).

```bash
curl -s -X POST http://host.containers.internal:3457/todos \
  -H "Content-Type: application/json" \
  -d '{"chat_jid":"<chat_jid>","text":"<todo text>","priority":"<low|normal|high>","due_date":"<YYYY-MM-DD or null>"}'
```

### list_items
Fetch open todos and upcoming reminders.

```bash
curl -s "http://host.containers.internal:3457/items?chat_jid=<chat_jid>"
```

Format the response clearly:
- Reminders: show text and due time in Europe/London timezone
- Todos: show text, priority (🔴 high, 🟡 normal, 🟢 low)

### complete_item
Mark a reminder or todo as done. Match the user's description to the most likely item from their list first.

```bash
curl -s -X PATCH http://host.containers.internal:3457/items/<id>/complete \
  -H "Content-Type: application/json" \
  -d '{"type":"reminder"}'  # or "todo"
```

### cancel_item
Cancel a pending reminder or todo.

```bash
curl -s -X PATCH http://host.containers.internal:3457/items/<id>/cancel \
  -H "Content-Type: application/json" \
  -d '{"type":"reminder"}'  # or "todo"
```

## Behaviour Guidelines

- Always confirm after creating: "Got it — I'll remind you about X on [day] at [time]"
- For ambiguous times ("tomorrow morning") ask for clarification before creating
- When listing items, if nothing is due say "You're all clear — nothing on your list"
- When completing/cancelling, fetch the list first if needed to find the right ID
- Times are always displayed in Europe/London to the user
- Never expose raw IDs or API responses to the user
