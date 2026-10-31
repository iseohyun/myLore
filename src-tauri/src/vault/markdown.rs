//! 마크다운 YAML Frontmatter 파싱, UUID 주입, `.myLore` 템플릿 보장.

use crate::*;

/// 경로 내에 `.myLore`, OneDrive 임시 동기화 폴더, 또는 Git/빌드 캐시 폴더가 포함되어 있는지 확인합니다.
pub(crate) fn is_internal_mylore_path(path: &Path) -> bool {
    path.components().any(|c| {
        let s = c.as_os_str().to_string_lossy();
        s.eq_ignore_ascii_case(".mylore")
            || s.eq_ignore_ascii_case(".git")
            || s.eq_ignore_ascii_case("node_modules")
            || s.eq_ignore_ascii_case("target")
            || s.eq_ignore_ascii_case("dist")
            || s.eq_ignore_ascii_case("build")
            || s.eq_ignore_ascii_case(".next")
            || s.eq_ignore_ascii_case(".tmp.drivedownload")
            || s.eq_ignore_ascii_case(".tmp.driveupload")
    })
}

/// 프로젝트 베이스 폴더의 `.myLore/templates`에 기본 마크다운 템플릿을 생성·관리합니다.
pub(crate) fn ensure_projects_mylore_templates(conn: &Connection) -> PathBuf {
    let projects_base: String = projects_base_path_string(&conn);

    let templates_dir = Path::new(&projects_base).join(".myLore").join("templates");
    let _ = fs::create_dir_all(&templates_dir);

    let default_templates = vec![
        (
            "project_main.md",
            r#"---
title: "{{title}}"
description: "프로젝트 기본 main.md 템플릿 (개론 및 서브미션 진행율 표 포함)"
status: "진행중"
milestone: "초기 설계 및 목표 수립"
---
## 개론
- **{{title}}**: 프로젝트의 의미 및 한 줄 정의
- **핵심과제**:
  1. 첫 번째 핵심 목표 및 해결하고자 하는 과제
  2. 두 번째 핵심 목표 및 산출물 정의
- **구현**:
  - 기술 스택 / 실행 환경 요약 (`Projects/{{title}}/main.md`)

---

## 🎯 서브 미션
|미션|진행율|비고|링크|
| :--- | :--- | :--- | :--- |
|초기 설계 및 구현|0%(0/1)|핵심 기능 정의 및 세부 과제 관리|[설계.md]|
|버그수정|0%(0/1)|사용중 발생한 버그를 개선|[bugs.md]|
---
"#,
        ),
        (
            "project_submission.md",
            r#"---
title: "{{title}}"
description: "프로젝트 하위 서브미션({submission}.md) 상세 태스크 관리 표 템플릿"
category: "서브미션"
---
<!-- 진행 사항: [대기중 | 수정중 | 수정 후 확인 대기 | YYYY-MM-DD hh:mm:ss] -->
|task ID|진행 사항|내용|개선내용|
| :--- | :--- | :--- | :--- |
|1|대기중|상세 요구사항 또는 해결할 내용을 서술하세요||
"#,
        ),
        (
            "article_research.md",
            r#"---
title: "{{title}}"
description: "개발 커리어·사색·수영 등 아티클/영상 제작을 위한 자료조사 템플릿"
status: "자료수집중"
category: "콘텐츠기획"
---
# 🎬 {{title}} (아티클 · 영상 기획 및 자료조사)

| 구분 | 기획 내용 | 상태 |
| :--- | :--- | :---: |
| **타겟 포맷** | 기술 블로그 아티클 / 유튜브 영상 스크립트 | 기획중 |
| **핵심 메시지** | 독자/시청자에게 전달할 가장 중요한 인사이트 1가지 | 작성필요 |
| **예상 분량** | 아티클 1편 (또는 10분 내외 영상) | - |

---

## 📌 핵심 할 일 (Production Tasks)
- [!] 핵심 레퍼런스 및 근거 자료 3건 이상 수집
- [/] 도입부(Hook) 및 전체 목차 구조화
- [ ] 초안(Draft) 작성 및 시각화/표 정리

---

## 📚 수집된 자료 및 인용 (References)
> 핵심 인용구나 기억해야 할 문장을 여기에 기록합니다.

1. 첫 번째 참고 자료 요약
2. 두 번째 참고 자료 요약
"#,
        ),
        (
            "diary_default.md",
            r#"---
title: "{{title}}"
description: "구글 캘린더 양방향 연동 호환 일기(Diary) 기본 템플릿"
---
# 📅 {{date}} — {{title}}

| 시간대 | 주요 활동 / 일정 요약 | 구분 |
| :---: | :--- | :---: |
| 오전 | 오전 주요 일정 또는 컨디션 기록 | 일상 |
| 오후 | 핵심 프로젝트/업무 진행 내역 | 개발/업무 |
| 저녁 | 운동(수영 등) 및 개인 회고 | 기록 |

---

## ✅ 오늘의 체크리스트
- [!] 오늘 반드시 마무리할 핵심 일과
- [ ] 내일로 이관할 후속 일정 점검

---

## 💬 상세 기록 & 라이프로그 메모
우측 사이드바의 **[📱 라이프로그]** 탭에서 당일 카드 결제 내역이나 카카오톡 대화를 클릭하면 이 본문에 즉시 삽입됩니다.
"#,
        ),
    ];

    for (file_name, content) in default_templates {
        let p = templates_dir.join(file_name);
        if !p.exists() {
            let _ = fs::write(&p, content);
        }
    }

    templates_dir
}

pub(crate) fn parse_markdown_yaml(raw: &str) -> (String, String, HashMap<String, String>) {
    let normalized = raw.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    let mut map = HashMap::new();
    if !normalized.starts_with("---\n") {
        return (String::new(), normalized, map);
    }
    let close_pos = normalized[4..]
        .find("\n---\n")
        .map(|idx| idx + 4)
        .or_else(|| {
            if normalized.ends_with("\n---") {
                Some(normalized.len() - 4)
            } else {
                None
            }
        });

    if let Some(pos) = close_pos {
        let yaml_raw = normalized[4..pos].to_string();
        let body = if pos + 5 <= normalized.len() {
            normalized[pos + 5..].to_string()
        } else {
            String::new()
        };
        for line in yaml_raw.lines() {
            if let Some(colon) = line.find(':') {
                let k = line[..colon].trim().to_string();
                let raw_v = line[colon + 1..].trim();
                let v = if let Some(rest) = raw_v.strip_prefix('"') {
                    rest.find('"')
                        .map(|idx| rest[..idx].trim().to_string())
                        .unwrap_or_else(|| rest.trim_matches('"').trim().to_string())
                } else if let Some(rest) = raw_v.strip_prefix('\'') {
                    rest.find('\'')
                        .map(|idx| rest[..idx].trim().to_string())
                        .unwrap_or_else(|| rest.trim_matches('\'').trim().to_string())
                } else {
                    let without_comment = match raw_v.find('#') {
                        Some(idx) => &raw_v[..idx],
                        None => raw_v,
                    };
                    without_comment
                        .trim()
                        .trim_matches('"')
                        .trim_matches('\'')
                        .trim()
                        .to_string()
                };
                if !k.is_empty() {
                    map.insert(k, v);
                }
            }
        }
        (yaml_raw, body, map)
    } else {
        (String::new(), normalized, map)
    }
}

pub(crate) fn ensure_uuid_in_markdown_file(
    path: &Path,
    existing_uuid: Option<&str>,
) -> Result<(String, String, bool), String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let (yaml_raw, body, frontmatter) = parse_markdown_yaml(&raw);

    if let Some(u) = frontmatter.get("uuid") {
        if !u.trim().is_empty() {
            return Ok((u.trim().to_string(), raw, false));
        }
    }

    let assigned_uuid = existing_uuid
        .map(|s| s.to_string())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let stripped = raw.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    let new_raw = if yaml_raw.is_empty() && !stripped.starts_with("---\n") {
        format!("---\nuuid: \"{}\"\n---\n{}", assigned_uuid, body)
    } else {
        format!("---\nuuid: \"{}\"\n{}\n---\n{}", assigned_uuid, yaml_raw, body)
    };

    fs::write(path, &new_raw).map_err(|e| e.to_string())?;
    Ok((assigned_uuid, new_raw, true))
}

/// 복사된 마크다운 문서의 중복 UUID 충돌을 해결하기 위해 YAML 내 `uuid` 값을 새 UUID로 교체합니다.
pub(crate) fn replace_uuid_in_markdown_file(
    path: &Path,
    new_uuid: &str,
) -> Result<String, String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let (yaml_raw, body, _) = parse_markdown_yaml(&raw);
    let mut replaced = false;
    let mut next_yaml_lines: Vec<String> = Vec::new();
    for line in yaml_raw.lines() {
        if let Some(colon) = line.find(':') {
            let k = line[..colon].trim();
            if k.eq_ignore_ascii_case("uuid") {
                if !replaced {
                    next_yaml_lines.push(format!("uuid: \"{}\"", new_uuid));
                    replaced = true;
                }
                continue;
            }
        }
        next_yaml_lines.push(line.to_string());
    }
    if !replaced {
        next_yaml_lines.insert(0, format!("uuid: \"{}\"", new_uuid));
    }
    let new_raw = format!("---\n{}\n---\n{}", next_yaml_lines.join("\n"), body);
    fs::write(path, &new_raw).map_err(|e| e.to_string())?;
    Ok(new_raw)
}

pub(crate) fn parse_frontmatter_and_body_simple(raw: &str) -> (HashMap<String, String>, String) {
    let (_, body, fm) = parse_markdown_yaml(raw);
    (fm, body)
}
