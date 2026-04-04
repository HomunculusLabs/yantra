import { Node, mergeAttributes } from "@tiptap/core";
import {
  decodeDataviewAttribute,
  encodeDataviewAttribute,
} from "@/lib/markdown/dataview-shared";

export const DataviewExtension = Node.create({
  name: "dataview",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  isolating: true,
  defining: true,

  addAttributes() {
    return {
      source: {
        default: "",
        parseHTML: (element) =>
          decodeDataviewAttribute(element.getAttribute("data-dataview-source")),
        renderHTML: (attributes) => ({
          "data-dataview-source": encodeDataviewAttribute(
            String(attributes.source || "")
          ),
        }),
      },
      html: {
        default: "",
        parseHTML: (element) => element.innerHTML || "",
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-dataview="true"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-dataview": "true",
        class: "dataview-block",
      }),
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("div");

      const render = (currentNode: typeof node) => {
        dom.setAttribute("data-dataview", "true");
        dom.setAttribute(
          "data-dataview-source",
          encodeDataviewAttribute(String(currentNode.attrs.source || ""))
        );
        dom.className = "dataview-block";
        dom.contentEditable = "false";
        dom.innerHTML =
          currentNode.attrs.html ||
          `<div class="my-4 rounded-lg border border-border bg-muted/10 px-4 py-3 text-sm text-muted-foreground">Dataview block</div>`;
      };

      render(node);

      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type.name !== "dataview") return false;
          render(updatedNode);
          return true;
        },
        ignoreMutation: () => true,
      };
    };
  },
});
