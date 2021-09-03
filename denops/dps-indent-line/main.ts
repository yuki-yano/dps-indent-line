import type { Denops } from "https://deno.land/x/denops_std@v1.8.1/mod.ts";
import * as op from "https://deno.land/x/denops_std@v1.8.1/option/mod.ts";
import * as autocmd from "https://deno.land/x/denops_std@v1.8.1/autocmd/mod.ts";
import * as helper from "https://deno.land/x/denops_std@v1.8.1/helper/mod.ts";

const pluginName = "dps-indent-line";
let namespace: number;
let indentWidth: number;
let pos: Pos;
let startLine: number;
let endLine: number;
let extmarkIds: Array<number | undefined> = [];

type Line = {
  text: string;
  lineNumber: number;
  indent: number;
  spaces: number;
  isContext: boolean;
};

type Pos = {
  lineNumber: number;
  col: number;
};

const getNamespace = async (denops: Denops): Promise<number> => {
  if (namespace == null) {
    namespace = await denops.call(
      "nvim_create_namespace",
      pluginName,
    ) as number;
  }

  return namespace;
};

const getIndentWidth = async (denops: Denops): Promise<number> => {
  if (indentWidth == null) {
    indentWidth = await op.shiftwidth.get(denops);
  }

  return indentWidth;
};

const getStartOfLine = (lines: Array<Line>, index: number): number => {
  const startOfLine = lines[index].text.search(/\S/) + 1;
  if (startOfLine !== 0) {
    return startOfLine;
  }

  let line: Line;
  let startLine: Line = lines[index];
  let endLine: Line = lines[index];
  let i: number;

  i = lines.length;
  while (lines[i] != null) {
    line = lines[i];
    if (line.text !== "") {
      startLine = lines[i];
      break;
    }
    i--;
  }

  i = 0;
  while (lines[i] != null) {
    line = lines[i];
    if (line.text !== "") {
      endLine = lines[i];
      break;
    }
    i++;
  }

  return Math.min(
    startLine.text.search(/\S/) + 1,
    endLine.text.search(/\S/) + 1,
  );
};

const getIsContext = (
  pos: Pos,
  lines: Array<Line>,
  index: number,
  col: number,
): boolean => {
  let line: Line;
  let i: number;

  i = pos.lineNumber - 1;
  let startLine = pos.lineNumber - 1;

  while (lines[i] != null) {
    line = lines[i];

    if (line.text === "") {
      i--;
      continue;
    }

    // TODO: Use indent width
    const char = line.text.charAt(col % 2 === 0 ? col - 2 : col - 3);
    if (char === "" || char.match(/\s/)) {
      i--;
    } else {
      startLine = lines[i].lineNumber;
      break;
    }
  }

  i = pos.lineNumber - 1;
  let endLine = pos.lineNumber - 1;

  while (lines[i] != null) {
    line = lines[i];

    if (line.text === "") {
      i++;
      continue;
    }

    // TODO: Use indent width
    const char = line.text.charAt(col % 2 === 0 ? col - 2 : col - 3);
    if (char === "" || char.match(/\s/)) {
      i++;
    } else {
      endLine = lines[i].lineNumber;
      break;
    }
  }

  return lines[index].lineNumber > startLine &&
    lines[index].lineNumber < endLine;
};

const getLines = async (denops: Denops): Promise<ReadonlyArray<Line>> => {
  const indentWidth = await getIndentWidth(denops);

  // startLine = await denops.call("line", "w0") as number;
  // endLine = await denops.call("line", "w$") as number;
  startLine = (await denops.call("line", "0") as number);
  endLine = await denops.call("line", "$") as number;

  const _pos = await denops.call("getpos", ".") as [
    number,
    number,
    number,
    number,
  ];

  pos = {
    lineNumber: _pos[1],
    col: _pos[2] + _pos[3],
  };

  const bufferLines = await denops.call(
    "getline",
    startLine,
    endLine,
  ) as ReadonlyArray<
    string
  >;

  let lines: Array<Line> = [];
  for (const [index, text] of bufferLines.entries()) {
    const lineNumber = startLine + index + 1;
    const groups = /(?<space>^\s*)/.exec(text)?.groups;

    if (groups == null) {
      lines = [...lines, {
        text,
        lineNumber,
        indent: 0,
        spaces: 0,
        isContext: false,
      }];
      continue;
    }

    // TODO: Not use Vim script
    if (groups.space.length === 0) {
      lines = [...lines, {
        text,
        lineNumber,
        indent: 0,
        spaces: 0,
        isContext: false,
      }];
      continue;
    }

    lines = [...lines, {
      text,
      lineNumber,
      indent: Math.floor(groups.space.length / indentWidth),
      spaces: groups.space.length,
      isContext: false,
    }];
  }

  for (const [index, line] of lines.entries()) {
    if (line.spaces === 0) {
      let i: number;

      i = index;
      let prevIndent = 0;
      while (lines[i] != null) {
        if (lines[i].text !== "") {
          prevIndent = lines[i].indent;
          break;
        }
        i--;
      }

      i = index;
      let nextIndent = 0;
      while (lines[i] != null) {
        if (lines[i].text !== "") {
          nextIndent = lines[i].indent;
          break;
        }
        i++;
      }

      line.indent = Math.min(prevIndent, nextIndent) + 1;
    }
  }

  const startOfLine = getStartOfLine(lines, pos.lineNumber - 1);
  const col: number = pos.col;
  for (const [index, line] of lines.entries()) {
    const isContext = getIsContext(
      pos,
      lines,
      index,
      col > startOfLine ? startOfLine - 1 : col,
    );
    line.isContext = isContext;
  }

  return lines;
};

const renderIndent = async (denops: Denops, lines: ReadonlyArray<Line>) => {
  await Promise.all(extmarkIds.map(async (_) => {
    await denops.call(
      "nvim_buf_clear_namespace",
      0,
      await getNamespace(denops),
      0,
      -1,
    );
    // if (id != null) {
    //   denops.call("nvim_buf_del_extmark", 0, await getNamespace(denops), id);
    // }
  }));
  extmarkIds = [];

  Promise.all(
    lines.map(async ({ indent, isContext }, i) => {
      if (indent <= 1) {
        return;
      }

      const lineNumber = startLine + i;

      let virtText: Array<[string, string]> = [[" ", "Normal"]];
      for (let i = 0; i < indent - 1; i++) {
        const contextLevel = Math.min(
          Math.floor(pos.col / await getIndentWidth(denops) - 2),
          lines[pos.lineNumber - 1].indent - 2,
        );
        virtText = [...virtText, [
          " |",
          isContext && contextLevel === i ? "Yellow" : "LineNr",
        ]];
      }

      return await denops.call(
        "nvim_buf_set_extmark",
        0,
        await getNamespace(denops),
        lineNumber,
        0,
        {
          virt_text: virtText,
          virt_text_pos: "overlay",
          hl_mode: "combine",
        },
      ) as number;
    }),
  ).then((result) => {
    extmarkIds = result;
  });
};

export const main = async (denops: Denops): Promise<void> => {
  denops.dispatcher = {
    renderIndent: async (): Promise<void> => {
      const lines = await getLines(denops);
      await renderIndent(denops, lines);
    },
  };

  await helper.execute(
    denops,
    `
    command! RenderIndent call denops#notify("${denops.name}", "renderIndent", [])
    `,
  );

  await autocmd.group(denops, pluginName, (helper) => {
    helper.define("CursorHold", "*", "RenderIndent");
    helper.define("BufEnter", "*", "RenderIndent");
    helper.define("InsertChange", "*", "RenderIndent");
    helper.define("TextChanged", "*", "RenderIndent");
    helper.define("TextChangedI", "*", "RenderIndent");
    // helper.define("WinScrolled", "*", "RenderIndent");
  });
};
