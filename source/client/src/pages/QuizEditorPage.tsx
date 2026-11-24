import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { quizSetApi, validateQuestion, type QuestionInput } from '../mock/api';
import { QTYPE_LABEL } from '../lib/format';
import { notify } from '../store/live';
import type { Question, QuestionType, QuizSet, Visibility } from '../types';
import { Empty, ErrorBox, Modal, Spinner, Toggle } from '../components/ui';
import { Icon } from '../components/icons';

export default function QuizEditorPage() {
  const id = Number(useParams().id);
  const qc = useQueryClient();
  const { data: set, error, isLoading } = useQuery({ queryKey: ['quiz-set', id], queryFn: () => quizSetApi.get(id) });
  const [editing, setEditing] = useState<Question | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [toDelete, setToDelete] = useState<Question | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['quiz-set', id] });
    qc.invalidateQueries({ queryKey: ['quiz-sets'] });
  };
  const move = useMutation({ mutationFn: (a: { qid: number; dir: -1 | 1 }) => quizSetApi.moveQuestion(id, a.qid, a.dir), onSuccess: refresh });
  const del = useMutation({
    mutationFn: (qid: number) => quizSetApi.deleteQuestion(id, qid),
    onSuccess: () => {
      refresh();
      setToDelete(null);
      notify('Đã xóa câu hỏi', 'success');
    },
  });

  if (isLoading) return <Spinner />;
  if (error || !set)
    return (
      <div className="page">
        <ErrorBox error={error} />
        <Link to="/quiz-sets" className="link-arrow back">
          <Icon name="arrowLeft" /> Về danh sách bộ đề
        </Link>
      </div>
    );

  return (
    <div className="page">
      <Link to="/quiz-sets" className="link-arrow back">
        <Icon name="arrowLeft" /> Bộ đề
      </Link>
      <MetaForm set={set} onSaved={refresh} />

      <div className="section-head">
        <h2 className="section-title">
          Câu hỏi <span className="muted num">{set.questions.length}</span>
        </h2>
        <div className="row gap-8">
          <button className="btn btn-quiet" onClick={() => setImporting(true)}>
            <Icon name="upload" /> Nhập CSV
          </button>
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" /> Thêm câu hỏi
          </button>
        </div>
      </div>

      {set.questions.length === 0 ? (
        <Empty
          title="Bộ đề chưa có câu hỏi"
          action={
            <button className="btn" onClick={() => setEditing('new')}>
              Thêm câu đầu tiên
            </button>
          }
        >
          Cần ít nhất 1 câu để dùng bộ đề trong phòng.
        </Empty>
      ) : (
        <ol className="q-list">
          {set.questions.map((q, i) => (
            <li key={q.id} className="q-item">
              <span className="q-num num">{String(i + 1).padStart(2, '0')}</span>
              <div className="q-body">
                <div className="q-meta">
                  <span>{QTYPE_LABEL[q.type]}</span>
                  <span className="num">{q.timeLimitMs ? `${q.timeLimitMs / 1000} giây` : 'thời gian theo phòng'}</span>
                  <span className="num">{q.points} điểm</span>
                </div>
                <div className="q-text">{q.content}</div>
                <ul className="q-choices">
                  {q.choices.map((c) => (
                    <li key={c.id} className={c.isCorrect ? 'correct' : ''}>
                      {c.isCorrect && <Icon name="check" size={13} />}
                      {c.content}
                      {c.isCorrect && <span className="sr-only">(đúng)</span>}
                    </li>
                  ))}
                </ul>
                {q.explanation && <p className="q-explain">{q.explanation}</p>}
              </div>
              <div className="q-actions">
                <button className="icon-btn" disabled={i === 0} onClick={() => move.mutate({ qid: q.id, dir: -1 })} aria-label={`Đưa câu ${i + 1} lên trên`}>
                  <Icon name="arrowUp" />
                </button>
                <button
                  className="icon-btn"
                  disabled={i === set.questions.length - 1}
                  onClick={() => move.mutate({ qid: q.id, dir: 1 })}
                  aria-label={`Đưa câu ${i + 1} xuống dưới`}
                >
                  <Icon name="arrowDown" />
                </button>
                <button className="btn btn-sm" onClick={() => setEditing(q)}>
                  Sửa
                </button>
                <button className="btn btn-sm btn-danger-quiet" onClick={() => setToDelete(q)}>
                  Xóa
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}

      {editing && <QuestionModal setId={id} question={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {importing && <ImportModal setId={id} onClose={() => setImporting(false)} onDone={refresh} />}
      {toDelete && (
        <Modal
          title="Xóa câu hỏi này?"
          onClose={() => setToDelete(null)}
          footer={
            <>
              <button className="btn btn-quiet" onClick={() => setToDelete(null)}>
                Hủy
              </button>
              <button className="btn btn-danger" disabled={del.isPending} onClick={() => del.mutate(toDelete.id)}>
                {del.isPending ? 'Đang xóa…' : 'Xóa câu hỏi'}
              </button>
            </>
          }
        >
          <blockquote className="quote">{toDelete.content}</blockquote>
          <p className="muted small">Các trận đã chơi không bị ảnh hưởng.</p>
        </Modal>
      )}
    </div>
  );
}

function MetaForm({ set, onSaved }: { set: QuizSet; onSaved: () => void }) {
  const [title, setTitle] = useState(set.title);
  const [description, setDescription] = useState(set.description);
  const [visibility, setVisibility] = useState<Visibility>(set.visibility);
  useEffect(() => {
    setTitle(set.title);
    setDescription(set.description);
    setVisibility(set.visibility);
  }, [set.title, set.description, set.visibility]);
  const dirty = title !== set.title || description !== set.description || visibility !== set.visibility;

  // Cảnh báo khi rời trang mà chưa lưu
  useEffect(() => {
    if (!dirty) return;
    const onBefore = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, [dirty]);

  const save = useMutation({
    mutationFn: () => quizSetApi.update(set.id, { title, description, visibility }),
    onSuccess: () => {
      onSaved();
      notify('Đã lưu thông tin bộ đề', 'success');
    },
  });
  return (
    <form
      className="meta-form"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <label className="sr-only" htmlFor="set-title">
        Tên bộ đề
      </label>
      <input id="set-title" name="set-title" className="title-input" value={title} onChange={(e) => setTitle(e.target.value)} required autoComplete="off" />
      <label className="sr-only" htmlFor="set-desc">
        Mô tả
      </label>
      <textarea id="set-desc" name="set-description" className="desc-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Thêm mô tả ngắn…" rows={2} />
      <div className="meta-bar">
        <Toggle checked={visibility === 'PUBLIC'} onChange={(v) => setVisibility(v ? 'PUBLIC' : 'PRIVATE')} label="Công khai trong thư viện" />
        <div className="row gap-8">
          {dirty && <span className="muted small">Có thay đổi chưa lưu</span>}
          <Link to={`/quiz-sets/${set.id}/stats`} className="btn btn-sm btn-quiet">
            <Icon name="chart" /> Thống kê
          </Link>
          <button className="btn btn-sm btn-primary" disabled={!dirty || save.isPending}>
            {save.isPending ? 'Đang lưu…' : 'Lưu thông tin'}
          </button>
        </div>
      </div>
      <ErrorBox error={save.error} />
    </form>
  );
}

const blankChoices = (type: QuestionType) =>
  type === 'TRUE_FALSE'
    ? [
        { content: 'Đúng', isCorrect: true },
        { content: 'Sai', isCorrect: false },
      ]
    : [
        { content: '', isCorrect: true },
        { content: '', isCorrect: false },
        { content: '', isCorrect: false },
        { content: '', isCorrect: false },
      ];

function QuestionModal({ setId, question, onClose, onSaved }: { setId: number; question: Question | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<QuestionInput>(() =>
    question
      ? {
          type: question.type,
          content: question.content,
          imageUrl: question.imageUrl,
          timeLimitMs: question.timeLimitMs,
          points: question.points,
          explanation: question.explanation,
          choices: question.choices.map((c) => ({ content: c.content, isCorrect: c.isCorrect })),
        }
      : { type: 'SINGLE', content: '', imageUrl: null, timeLimitMs: null, points: 100, explanation: '', choices: blankChoices('SINGLE') },
  );
  const [touched, setTouched] = useState(false);
  const save = useMutation({
    mutationFn: () => (question ? quizSetApi.updateQuestion(setId, question.id, form) : quizSetApi.addQuestion(setId, form)),
    onSuccess: () => {
      onSaved();
      notify(question ? 'Đã cập nhật câu hỏi' : 'Đã thêm câu hỏi', 'success');
      onClose();
    },
  });
  const invalid = validateQuestion(form);

  const setType = (type: QuestionType) => {
    let choices = form.choices;
    if (type === 'TRUE_FALSE') choices = blankChoices('TRUE_FALSE');
    else if (form.type === 'TRUE_FALSE') choices = blankChoices(type);
    else if (type === 'SINGLE') {
      const first = choices.findIndex((c) => c.isCorrect);
      choices = choices.map((c, i) => ({ ...c, isCorrect: i === (first < 0 ? 0 : first) }));
    }
    setForm({ ...form, type, choices });
  };
  const setChoice = (i: number, patch: Partial<QuestionInput['choices'][number]>) =>
    setForm({ ...form, choices: form.choices.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const markCorrect = (i: number) => {
    if (form.type === 'MULTIPLE') setChoice(i, { isCorrect: !form.choices[i].isCorrect });
    else setForm({ ...form, choices: form.choices.map((c, j) => ({ ...c, isCorrect: j === i })) });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!invalid) save.mutate();
  };

  const multi = form.type === 'MULTIPLE';

  return (
    <Modal title={question ? 'Sửa câu hỏi' : 'Thêm câu hỏi'} onClose={onClose} wide>
      <form className="form" onSubmit={submit}>
        <fieldset className="field">
          <legend className="field-label">Loại câu</legend>
          <div className="segmented" role="radiogroup" aria-label="Loại câu">
            {(['SINGLE', 'MULTIPLE', 'TRUE_FALSE'] as const).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={form.type === t} className={form.type === t ? 'active' : ''} onClick={() => setType(t)}>
                {QTYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="field">
          <span className="field-label">Nội dung câu hỏi</span>
          <textarea name="q-content" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={2} autoFocus />
        </label>

        <fieldset className="field">
          <legend className="field-label">
            Lựa chọn · {multi ? 'đánh dấu mọi đáp án đúng' : 'chọn 1 đáp án đúng'} · 2–6 lựa chọn
          </legend>
          <div className="choice-editor">
            {form.choices.map((c, i) => (
              <div key={i} className={`ce-row ${c.isCorrect ? 'correct' : ''}`}>
                <label className="ce-mark">
                  <input
                    type={multi ? 'checkbox' : 'radio'}
                    name="q-correct"
                    checked={c.isCorrect}
                    onChange={() => markCorrect(i)}
                    aria-label={`Lựa chọn ${i + 1} là đáp án đúng`}
                  />
                </label>
                <input
                  name={`choice-${i}`}
                  value={c.content}
                  onChange={(e) => setChoice(i, { content: e.target.value })}
                  placeholder={`Lựa chọn ${i + 1}…`}
                  aria-label={`Nội dung lựa chọn ${i + 1}`}
                  disabled={form.type === 'TRUE_FALSE'}
                  autoComplete="off"
                />
                {form.type !== 'TRUE_FALSE' && (
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={form.choices.length <= 2}
                    onClick={() => setForm({ ...form, choices: form.choices.filter((_, j) => j !== i) })}
                    aria-label={`Xóa lựa chọn ${i + 1}`}
                  >
                    <Icon name="close" />
                  </button>
                )}
              </div>
            ))}
            {form.type !== 'TRUE_FALSE' && form.choices.length < 6 && (
              <button type="button" className="btn btn-sm btn-quiet ce-add" onClick={() => setForm({ ...form, choices: [...form.choices, { content: '', isCorrect: false }] })}>
                <Icon name="plus" /> Thêm lựa chọn
              </button>
            )}
          </div>
        </fieldset>

        <div className="grid-2">
          <div className="field">
            <span className="field-label">Thời gian</span>
            <Toggle checked={form.timeLimitMs == null} onChange={(v) => setForm({ ...form, timeLimitMs: v ? null : 30000 })} label="Dùng thời gian của phòng" />
            {form.timeLimitMs != null && (
              <label className="inline-field">
                <input
                  type="number"
                  inputMode="numeric"
                  name="q-time"
                  min={5}
                  max={300}
                  value={form.timeLimitMs / 1000}
                  onChange={(e) => setForm({ ...form, timeLimitMs: Number(e.target.value) * 1000 })}
                  aria-label="Số giây cho câu này"
                />
                <span className="muted">giây</span>
              </label>
            )}
          </div>
          <label className="field">
            <span className="field-label">Điểm tối đa</span>
            <input type="number" inputMode="numeric" name="q-points" min={1} max={1000} value={form.points} onChange={(e) => setForm({ ...form, points: Number(e.target.value) })} />
          </label>
        </div>
        <label className="field">
          <span className="field-label">Lời giải thích</span>
          <textarea name="q-explanation" value={form.explanation ?? ''} onChange={(e) => setForm({ ...form, explanation: e.target.value })} rows={2} />
          <span className="field-hint">Hiện cho người chơi sau khi câu được chốt.</span>
        </label>

        {touched && invalid && (
          <div className="alert alert-error" role="alert">
            {invalid}
          </div>
        )}
        <ErrorBox error={save.error} />
        <div className="modal-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Hủy
          </button>
          <button className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Đang lưu…' : question ? 'Lưu thay đổi' : 'Thêm câu hỏi'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const CSV_SAMPLE = `type,content,choice1,choice2,choice3,choice4,correct,timeSec,points,explanation
SINGLE,Giao thức nào dùng cổng 53?,HTTP,DNS,SSH,FTP,2,20,100,DNS dùng cổng 53
MULTIPLE,Giao thức nào hướng kết nối?,TCP,UDP,SCTP,ICMP,1|3,30,100,
TRUE_FALSE,Ping dùng giao thức ICMP,Đúng,Sai,1,15,100,`;

function ImportModal({ setId, onClose, onDone }: { setId: number; onClose: () => void; onDone: () => void }) {
  const [csv, setCsv] = useState(CSV_SAMPLE);
  const imp = useMutation({
    mutationFn: () => quizSetApi.importCsv(setId, csv),
    onSuccess: (r) => {
      onDone();
      if (r.added) notify(`Đã nhập ${r.added} câu hỏi`, 'success');
    },
  });
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setCsv(await f.text());
  };
  return (
    <Modal title="Nhập câu hỏi từ CSV" onClose={onClose} wide>
      <div className="form">
        <p className="note">
          Mỗi dòng một câu: <code translate="no">type,content,lựa chọn…,correct,timeSec,points,explanation</code>. Cột <code translate="no">correct</code> là số thứ
          tự đáp án đúng; nhiều đáp án ngăn bằng <code translate="no">|</code>.
        </p>
        <label className="field">
          <span className="field-label">Chọn file</span>
          <input type="file" name="csv-file" accept=".csv,text/csv" onChange={onFile} />
        </label>
        <label className="field">
          <span className="field-label">Hoặc dán nội dung</span>
          <textarea name="csv" className="mono" rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} spellCheck={false} />
        </label>
        {imp.data && (
          <div className={`alert ${imp.data.errors.length ? 'alert-warn' : 'alert-good'}`} role="status">
            Đã thêm {imp.data.added} câu.
            {imp.data.errors.length > 0 && (
              <ul>
                {imp.data.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <ErrorBox error={imp.error} />
        <div className="modal-actions">
          <button className="btn btn-quiet" onClick={onClose}>
            Đóng
          </button>
          <button className="btn btn-primary" disabled={imp.isPending} onClick={() => imp.mutate()}>
            {imp.isPending ? 'Đang nhập…' : 'Nhập câu hỏi'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
