'use strict';
window.TripSheet = (()=>{
 const id='';
 function rows(raw){const a=raw.indexOf('{'),b=raw.lastIndexOf(')');if(a<0||b<a)throw Error('시트 응답을 읽지 못했어요.');const o=JSON.parse(raw.slice(a,b));if(o.status!=='ok'||!Array.isArray(o.table?.rows))throw Error('시트 접근 권한을 확인해 주세요.');return o.table.rows.map(r=>r.c.map(c=>c?String(c.f??c.v??'').trim():''));}
 function iso(s){const m=String(s).match(/(2027)[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);if(!m)throw Error('체크인·체크아웃 날짜 형식을 확인해 주세요.');return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;}
 function parse(scheduleRaw,bookingRaw,old,normalize){
  const schedule=rows(scheduleRaw),booking=rows(bookingRaw);const header=schedule.find(r=>r[0]==='시간');if(!header)throw Error('일정표의 시간 행을 찾지 못했어요.');
  const days=old.days.map(d=>{
   const col=header.findIndex(h=>{const m=String(h).match(/(\d{1,2})\/(\d{1,2})/);return m&&`2027-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`===d.date;});if(col<1)throw Error('여행 날짜 열이 누락됐어요.');
   const seen=new Set();const events=[];
   for(const r of schedule){const m=(r[0]||'').match(/^(\d{1,2})\s*[-~–]\s*\d{1,2}$/);if(!m)continue;const hour=Number(m[1]);if(hour>23||seen.has(hour))throw Error('시간 행이 중복되거나 올바르지 않아요.');seen.add(hour);const text=normalize(r[col]||'');if(!text)continue;const time=String(hour).padStart(2,'0')+':00';const previous=d.events.find(e=>e.time===time&&normalize(e.text)===text);events.push({id:`sheet-${d.date}-${hour}`,time,text,raw:r[col]||'',done:previous?.done??false});}
   if(seen.size!==24)throw Error('일정표의 0-1부터 23-24 시간 행을 확인해 주세요.');
   return {date:d.date,city:header[col].split('\n')[0].trim(),events:events.sort((a,b)=>a.time.localeCompare(b.time))};
  });
  const hotels=[];let h=null;let flightHeader=null;const flights=[];
  for(const r of booking){
   if(r.includes('숙소명')){h=r;continue;}
   if(r.includes('출발 도시')){flightHeader=r;h=null;continue;}
   if(h){const region=h.indexOf('지역'),name=h.indexOf('숙소명'),ci=h.indexOf('체크인'),co=h.indexOf('체크아웃');const oldHotel=old.hotels.find(x=>x.city===r[region]);if(!oldHotel)continue;if(ci<0||co<0)throw Error('숙소 날짜 열을 찾지 못했어요.');const checkin=iso(r[ci]),checkout=iso(r[co]);if(checkout<=checkin)throw Error('체크아웃 날짜를 확인해 주세요.');hotels.push({id:oldHotel.id,city:r[region],name:r[name]||'',checkin,checkout,room:h.indexOf('룸타입')>=0?r[h.indexOf('룸타입')]||'':'',platform:'',paid:null,net:null});}
   if(flightHeader){const from=r[flightHeader.indexOf('출발 도시')],to=r[flightHeader.indexOf('도착 도시')];if(!from||!to||from.includes('합계'))continue;const depart=r[flightHeader.indexOf('출발 시각')]||'',arrive=r[flightHeader.indexOf('도착 시각')]||'';const airline=flightHeader.indexOf('항공사');flights.push({route:from+' → '+to,date:depart+' 출발 · '+arrive+' 도착',airline:airline>=0?r[airline]||'':'',detail:from==='바르셀로나'&&iso(depart)!==days.at(-1).date?'시트의 출발 날짜와 여행 마지막 날이 달라요. 항공권을 확인해 주세요.':'편명은 항공권을 확인해 주세요.',paid:null});}
  }
  if(hotels.length!==7||new Set(hotels.map(h=>h.city)).size!==7||!flights.length||flights.length>10)throw Error('예약표의 숙소 또는 항공편 행을 확인해 주세요.');
  const when=f=>{const m=f.date.match(/2027\D+(\d{1,2})\D+(\d{1,2})(?:\D+(\d{1,2}):(\d{2}))?/);return m?[m[1],m[2],m[3]||'0',m[4]||'0'].map(x=>x.padStart(2,'0')).join(''):'99999999';};flights.sort((a,b)=>when(a).localeCompare(when(b)));
  return {...old,days,hotels,flights};
 }
 function checklist(raw){const r=rows(raw);if(r[0]?.[0]!=='ID'||r[0]?.[1]!=='준비물')throw Error('준비물 탭 형식이 달라요.');return r.slice(1).filter(x=>x[0]&&x[1]).slice(0,400).map(x=>({id:x[0].slice(0,40),text:x[1].slice(0,200),done:/^(true|1)$/i.test(x[2]||'')}));}
 const CARD_HEAD=['날짜','시간','일정 원문','카드 제목','작은 글씨'];
 function cardSrc(s){return String(s||'').replace(/\r\n?/g,'\n').trim();}
 function cards(raw){const r=rows(raw);if(!CARD_HEAD.every((h,i)=>r[0]?.[i]===h))return {};const out={};
  for(const x of r.slice(1,2000)){const m=String(x[0]||'').match(/(?:\d{4}\D+)?(\d{1,2})\s*[\/.월-]\s*(\d{1,2})/),t=String(x[1]||'').match(/^(\d{1,2})/);const title=String(x[3]||'').slice(0,80);if(!m||!t||Number(t[1])>23||!title||/확인 필요/.test(x[5]||''))continue;
   const key=`2027-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}|${t[1].padStart(2,'0')}:00`;(out[key]=out[key]||[]).push({src:cardSrc(x[2]),title,sub:String(x[4]||'').slice(0,200)});}
  return out;}
 function card(cardsMap,date,e){if(!e||typeof e.raw!=='string')return null;const src=cardSrc(e.raw);return (cardsMap?.[date+'|'+e.time]||[]).find(c=>c.src===src)||null;}
 return {id,rows,parse,checklist,cards,card,url:''};
})();
