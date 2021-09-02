import type { Denops } from "https://deno.land/x/denops_std@v1.8.1/mod.ts";
import * as op from "https://deno.land/x/denops_std@v1.8.1/option/mod.ts";
import * as autocmd from "https://deno.land/x/denops_std@v1.8.1/autocmd/mod.ts";
import * as helper from "https://deno.land/x/denops_std@v1.8.1/helper/mod.ts";

const pluginName = "dps-indent-line";
let namespace: number;
let indentWidth: number;
let startLine: number;
let extmarkIds: Array<number | undefined> = [];

type Line = {
  text: string;
  lineNumber: number;
  indent: number;
  spaces: number;
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

const isContext = (pos: Pos, bufferLines: ReadonlyArray<string>): boolean => {
  return true;
};

const getLines = async (denops: Denops): Promise<ReadonlyArray<Line>> => {
  const indentWidth = await getIndentWidth(denops);

  startLine = await denops.call("line", "w0") as number;
  const endLine = await denops.call("line", "w$") as number;
  const _pos = await denops.call("getpos", ".") as [
    number,
    number,
    number,
    number,
  ];

  const pos: Pos = {
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
    const lineNumber = startLine + index;
    const groups = /(?<space>^\s*)/.exec(text)?.groups;

    if (groups == null) {
      lines = [...lines, {
        text,
        lineNumber,
        indent: 0,
        spaces: 0,
      }];
      continue;
    }

    // TODO: Not use Vim script
    // if (groups.space.length === 0) {
    //   const spaces = await denops.call(
    //     "dps_indent_line#get_indent",
    //     lineNumber,
    //   ) as number;
    //
    //   lines = [...lines, {
    //     text,
    //     lineNumber,
    //     indent: Math.floor(spaces / indentWidth),
    //     spaces,
    //   }];
    //   continue;
    // }

    lines = [...lines, {
      text,
      lineNumber,
      indent: Math.floor(groups.space.length / indentWidth),
      spaces: groups.space.length,
    }];
  }

  return lines;
};

const renderIndent = async (denops: Denops, lines: ReadonlyArray<Line>) => {
  await Promise.all(extmarkIds.map(async (id) => {
    if (id != null) {
      denops.call("nvim_buf_del_extmark", 0, await getNamespace(denops), id);
    }
  }));
  extmarkIds = [];

  const indentWidth = await getIndentWidth(denops);

  Promise.all(
    lines.map(async ({ indent }, i) => {
      if (indent <= 1) {
        return;
      }

      const lineNumber = startLine + i - 1;
      const virtText = ` ${
        `${" ".repeat(indentWidth - 1)}|`.repeat(indent - 1)
      }`;

      return await denops.call(
        "nvim_buf_set_extmark",
        0,
        await getNamespace(denops),
        lineNumber,
        0,
        {
          virt_text: [[virtText, "LineNr"]],
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
    helper.define("BufEnter", "*", "RenderIndent");
    helper.define("InsertChange", "*", "RenderIndent");
    helper.define("TextChanged", "*", "RenderIndent");
    helper.define("WinScrolled", "*", "RenderIndent");
  });
};
