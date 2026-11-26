/* Deterministic synthetic fixtures. No records or calendars from a live service. */
(function(global){
  'use strict';
  const day=86400000, start=Date.UTC(2026,0,1), asOf=start+180*day;
  const departments=['Поддержка','Инфраструктура','Бизнес-системы','Рабочие места','Сети'];
  const statuses=['Закрыта','В работе','Новая','Ожидает'];
  const priorities=['Обычный','Средний','Высокий','Критический'];
  const services=['Доступ','Рабочее место','Связь','Приложения','Печать','Хранилище'];
  const rand=seed=>()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const between=(r,a,b)=>a+Math.floor(r()*(b-a+1));
  const name=i=>'Специалист '+String(i+1).padStart(3,'0');
  function ticket(i,r){
    const offset=Math.min(179,Math.floor(Math.sqrt(r())*180)), createdAt=start+day*offset;
    const status=statuses[r()<.61?0:between(r,1,3)], closed=status===statuses[0];
    const duration=closed?between(r,5,340):null, employee=between(r,0,49);
    // SLA and overdue are independently supplied synthetic indicators.
    return {uuid:'demoCall$'+(i+1),title:'Обращение '+(i+1),status,priority:priorities[Math.floor(r()*r()*3.99)],
      responsible:name(employee),department:departments[employee%5],service:services[between(r,0,5)],createdAt,
      closedAt:closed?Math.min(asOf,createdAt+duration*60000):null,duration,slaViolated:r()<.083,
      overdue:!closed&&r()<.17,ageDays:closed?null:Math.floor((asOf-createdAt)/day)};
  }
  function employee(i,r){
    const active=between(r,0,20),done=between(r,0,65);
    return {uuid:'demoPerson$'+(i+1),title:name(i),department:departments[i%5],active,done,
      loadPercent:Math.round(active/16*100),duration:done?between(r,16,115):null,
      period:start+Math.floor(i/50)%6*30*day};
  }
  function asset(i,r){
    const age=between(r,0,3100),warrantyDays=between(r,-400,760);
    return {uuid:'demoAsset$'+(i+1),title:'Актив '+(i+1),assetType:['Ноутбук','Монитор','Коммутатор','Принтер'][i%4],
      vendor:['Производитель A','Производитель B','Производитель C'][between(r,0,2)],department:departments[between(r,0,4)],
      state:['В эксплуатации','Резерв','В ремонте'][Math.floor(r()*r()*2.99)],ageYears:Math.round(age/36.525)/10,
      warrantyDays,incidents:between(r,0,12)};
  }
  const col=(code,title,type='string',unit='')=>({code,title,type,unit});
  const base=[col('uuid','UUID'),col('title','Название')];
  const schemas={
    tickets:[...base,col('status','Статус'),col('priority','Приоритет'),col('department','Подразделение'),col('responsible','Исполнитель'),col('service','Услуга'),
      col('createdAt','Поступило','date'),col('closedAt','Закрыто','date'),col('duration','Время решения','number','мин'),
      col('slaViolated','Нарушение SLA','boolean'),col('overdue','Просрочено','boolean'),col('ageDays','Возраст открытой заявки','number','дн')],
    people:[...base,col('department','Подразделение'),col('active','Активные задачи','number'),col('done','Выполненные задачи','number'),col('loadPercent','Загрузка','number','%'),
      col('duration','Среднее время сотрудника','number','мин'),col('period','Отчётный период','date')],
    assets:[...base,col('assetType','Тип'),col('vendor','Производитель'),col('department','Подразделение'),col('state','Состояние'),
      col('ageYears','Возраст','number','лет'),col('warrantyDays','До конца гарантии','number','дн'),col('incidents','Инциденты','number')]
  };
  const M=(op='count',field='')=>({op,field}),D=(field,bucket='none')=>({field,bucket});
  const F=(field,op,value)=>({field,op,value});
  const W=(id,title,type,dims=[],measure=M(),extra={})=>({id,title,type,dims,measure,...extra});
  const dashboards={
    tickets:[
      W('total','Всего обращений','kpi'),W('active','В работе','kpi',[],M(),{filter:F('status','eq','В работе')}),
      W('median','Медиана решения','kpi',[],M('median','duration')),W('sla','Нарушения SLA','kpi',[],M(),{filter:F('slaViolated','bool',true)}),
      W('incoming','Поступление обращений','area',[D('createdAt','week'),D('createdAt','day')],M(),{order:'key',limit:30}),
      W('status','Статусы обращений','donut',[D('status'),D('department')]),
      W('department','Обращения по подразделениям','bar',[D('department'),D('responsible')]),
      W('priority','Распределение приоритетов','column',[D('priority')]),
      W('closed','Закрытие обращений','line',[D('closedAt','week')],M(),{order:'key',limit:30,filter:F('closedAt','filled',null)}),
      W('staff','Количество по исполнителям','bar',[D('responsible')],M(),{limit:8}),
      W('avg','Среднее время решения','bar',[D('department')],M('avg','duration')),W('service','Услуги','treemap',[D('service')]),
      W('overdue','Просроченные по подразделениям','bar',[D('department')],M(),{filter:F('overdue','bool',true)}),
      W('age','Возраст открытых заявок, дни','histogram',[],M(),{x:'ageDays',limit:10})
    ],
    people:[
      W('staff','Сотрудники','kpi',[],M('distinct','uuid')),W('active','Активные задачи','kpi',[],M('sum','active')),W('done','Завершённые задачи','kpi',[],M('sum','done')),
      W('load','Текущая загрузка, %','bar',[D('department'),D('title')],M('avg','loadPercent')),
      W('dist','Распределение загрузки','histogram',[],M(),{x:'loadPercent'}),
      W('time','Среднее время сотрудника, мин','bar',[D('department')],M('avg','duration')),
      W('trend','Выполнено по отчётным периодам','line',[D('period','month')],M('sum','done'),{order:'key'})],
    assets:[W('assets','Всего активов','kpi'),W('incidents','Связанные инциденты','kpi',[],M('sum','incidents')),
      W('warranty','Гарантия истечёт за 90 дней','kpi',[],M(),{filter:F('warrantyDays','between',[0,90])}),
      W('type','Тип оборудования','donut',[D('assetType')]),W('vendor','Производители','bar',[D('vendor')]),
      W('dept','Активы по подразделениям','column',[D('department')]),W('state','Состояние оборудования','pie',[D('state')]),
      W('age','Возраст оборудования, лет','histogram',[],M(),{x:'ageYears'}),W('linked','Инциденты по типу','bar',[D('assetType')],M('sum','incidents'))]
  };
  const titles={tickets:'Аналитика обращений',people:'Аналитика сотрудников',assets:'Аналитика оборудования'};
  function generate(kind,n,seed=417){const f={tickets:ticket,people:employee,assets:asset}[kind],r=rand(seed);if(!f||!Number.isInteger(n)||n<0||n>100000)throw new Error('Объём 0…100 000');return Array.from({length:n},(_,i)=>f(i,r));}
  function config(kind){
    const second=kind==='tickets'?'priority':kind==='assets'?'state':'period';
    return {title:titles[kind],columns:schemas[kind],widgets:dashboards[kind],storageKey:'synthetic_'+kind,
      persistFilterFields:schemas[kind].map(c=>c.code),pivot:{rows:[D('department'),D(kind==='tickets'?'status':kind==='assets'?'assetType':'title')],
        cols:[D(second,kind==='people'?'month':'none')],measures:[M(),kind==='tickets'?M('avg','duration'):kind==='people'?M('sum','done'):M('sum','incidents')]}};
  }
  global.NSDDemo={generate,config};
})(globalThis);
