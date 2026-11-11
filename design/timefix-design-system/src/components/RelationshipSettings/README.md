Defines a relationship between two objects: the two object cards with the link between them, how records link, a name for each side, and the sentence it means.

**Use it for**: creating a relationship (from Add attribute or the schema map) and renaming an existing one's sides. **Don't use it for**: a record reference to a fixed list of people (an Owner attribute) or one attribute's settings.

**The consumer provides**: `objects` (`SchemaObject`: id, singular, plural, Lucide icon, hue), `value` (`Relationship`: fromId, toId, cardinality, fromName, toName), `onChange`, `mode` (`create` or `edit`), and `canChooseFrom` for the schema map. `describeRelationship`, `defaultNames` and `CardinalityDiagram` are exported.

**States**: create (linked object Select, swap sides, three cardinality cards), edit (objects and cardinality fixed, names editable), self relationship (a reverse name that must differ), narrow (stacked).

**Interaction**: the cardinality cards are a radio group (arrows choose); the diagram between the objects swaps in from 0.25 through (icon swap 09); the sentence underneath crossfades when it changes (TextSwap). Names follow the objects and cardinality (singular for one, plural for many) until someone types one.

**Replaces**: RelationshipSettings.
