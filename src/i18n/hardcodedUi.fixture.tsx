declare function appAlert(message: string, options?: { title?: string }): null;
declare function t(key: string): string;
function Fixture(_props: { label: string; title: string; placeholder: string; message: string; description: string }) { return null; }

export function AuditFixture() {
  const value = "localized";
  const element = document.createElement("div");
  element.textContent = "literal text content";
  element.innerText = `literal inner text`;
  element.innerHTML = "literal inner html" + "中文 HTML";
  element["textContent"] += "element access assignment";
  element.innerText ||= "logical assignment";
  element.innerHTML ??= ("wrapped assignment" as string);
  element.textContent = (`satisfies assignment` satisfies string)!;
  appAlert(t("translated.statement"), { title: `中文语句标题 ${"中文语句替换"}` });
  return <>
    <div>{"expression text"}</div>
    <div>{`template text`}</div>
    <div>{`中文头部 ${value} 中文尾部`}</div>
    <div>{true ? "conditional text" : "alternate condition"}</div>
    <img alt={"alternate text"} title={`中文属性 ${value} 中文尾部`} />
    {JSON.stringify({ label: "object label" })}
    <input value={`literal value`} />
    {appAlert(`中文调用 ${value} 中文尾部`)}
    <Fixture label={"literal label"} title={`literal title`} placeholder={"literal placeholder"} message={`literal message`} description={`中文描述 ${"中文描述替换"}`} />
    <div>{`${"中文替换"}`}</div>
    <div>{("concat " + "中文连接")}</div>
    {JSON.stringify({ label: `中文对象 ${"中文对象替换"}` })}
    {appAlert(t("translated.message"), { title: `中文标题 ${"中文标题替换"}` })}
  </>;
}
