import assert from "node:assert/strict";
import test from "node:test";

import { parseRootImport } from "./rootImportParser.ts";

test("CSV import parses BOM, CRLF, quoted delimiters, doubled quotes, and embedded newlines", () => {
  const result = parseRootImport(
    '\uFEFFabbr,en,cn,cat,desc\r\nSKU,"English, complete","中文\r\n名称","公共词根","Line one\r\nLine two with ""quoted"" text"\r\nNEXT,Next,下一个,公共词根,plain\r\n',
  );

  assert.equal(result.error, undefined);
  assert.deepEqual(result.items, [
    {
      abbr: "SKU",
      en: "English, complete",
      cn: "中文\r\n名称",
      cat: "公共词根",
      desc: 'Line one\r\nLine two with "quoted" text',
      _line: 2,
    },
    {
      abbr: "NEXT",
      en: "Next",
      cn: "下一个",
      cat: "公共词根",
      desc: "plain",
      _line: 5,
    },
  ]);
});

test("quoted fields preserve inner whitespace while unquoted cells are trimmed", () => {
  const result = parseRootImport('abbr,en,cn\n  ROOT  , " English " , " 中文 " \n');

  assert.deepEqual(result.items, [
    {
      abbr: "ROOT",
      en: " English ",
      cn: " 中文 ",
      cat: "",
      desc: "",
      _line: 2,
    },
  ]);
});

test("delimiter detection skips leading blank records and preserves physical source rows", () => {
  const result = parseRootImport("\r\nabbr\ten\tcn\r\nSKU\tStock\t库存单位\r\n");

  assert.deepEqual(result.items, [
    {
      abbr: "SKU",
      en: "Stock",
      cn: "库存单位",
      cat: "",
      desc: "",
      _line: 3,
    },
  ]);
});

test("TSV detection wins over commas in unquoted headerless descriptions", () => {
  const result = parseRootImport("SKU\tStock keeping unit\t库存单位\t业务对象\tOne, two, three, four, five, six");

  assert.deepEqual(result.items, [
    {
      abbr: "SKU",
      en: "Stock keeping unit",
      cn: "库存单位",
      cat: "业务对象",
      desc: "One, two, three, four, five, six",
      _line: 1,
    },
  ]);
});

test("TSV import permits quoted tabs and multiline cells while preserving source line numbers", () => {
  const result = parseRootImport(
    'abbr\ten\tcn\tcat\tdesc\r\nTABROOT\t"English\tlabel"\t中文\t公共词根\t"first line\r\nsecond line"\r\n',
  );

  assert.equal(result.error, undefined);
  assert.deepEqual(result.items, [
    {
      abbr: "TABROOT",
      en: "English\tlabel",
      cn: "中文",
      cat: "公共词根",
      desc: "first line\r\nsecond line",
      _line: 2,
    },
  ]);
});

test("pipe-delimited legacy imports remain supported and empty physical lines are skipped", () => {
  const result = parseRootImport("abbr|en|cn|cat|desc\n\nPIPEROOT|Pipe|管道|公共词根|说明\n");

  assert.equal(result.error, undefined);
  assert.deepEqual(result.items, [
    {
      abbr: "PIPEROOT",
      en: "Pipe",
      cn: "管道",
      cat: "公共词根",
      desc: "说明",
      _line: 3,
    },
  ]);
});

test("malformed quoting fails closed and reports the physical source row", () => {
  const cases = [
    {
      text: 'abbr,en,cn\r\nBAD,contains"quote,中文\r\n',
      message: "未加引号字段中出现双引号",
    },
    {
      text: 'abbr,en,cn\r\nBAD,"closed"tail,中文\r\n',
      message: "闭合引号后存在非法字符",
    },
    {
      text: 'abbr,en,cn\r\nBAD,"not closed,中文\r\n',
      message: "引号未闭合",
    },
  ];

  for (const { text, message } of cases) {
    const result = parseRootImport(text);
    assert.deepEqual(result.items, []);
    assert.match(result.error ?? "", /第 2 行格式错误/);
    assert.match(result.error ?? "", new RegExp(message));
  }
});

test("malformed quoting after an embedded newline points at its physical line", () => {
  const result = parseRootImport('abbr,en,cn\nBAD,"first line\nsecond"tail,中文\n');

  assert.deepEqual(result.items, []);
  assert.match(result.error ?? "", /第 3 行格式错误/);
});

test("header-only and whitespace-only inputs retain distinct empty-input behavior", () => {
  assert.deepEqual(parseRootImport("\uFEFFabbr,en,cn\r\n"), { items: [] });
  assert.deepEqual(parseRootImport("\uFEFF \r\n\t\r\n"), { items: [], error: "内容为空" });
});
